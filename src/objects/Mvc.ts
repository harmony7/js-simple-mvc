import Debug from 'debug';
const debug = Debug('js-simple-mvc');

export interface IController {
    canonicalPath: string;
    [action: string]: string | object | ((params: object) => object);
}

export type Loader<T> = (module: new (...args: any[]) => T) => (IController | null);

export class Mvc {

    appRoot: string;

    loaders: Loader<any>[];

    constructor(appRoot: string) {
        this.appRoot = appRoot;
        this.loaders = [];
    }

    public addLoader<T>(fn: Loader<T>) {
        this.loaders.unshift(fn);
    }

    public tryLoadController(pathSegments: string[], action: string): IController | null {

        const moduleName = pathSegments.join('/');
        const path = this.appRoot + '/' + moduleName;

        let controllerModule;
        try {
            controllerModule = require(path);
            debug(`Module ${moduleName} loaded`);
        } catch(ex) {
            debug(`ERROR: Module ${path} not found`);
            return null;
        }

        if (typeof controllerModule !== 'function') {
            if (controllerModule.default != null) {
                // If the module was an ES module then check 'default' export
                controllerModule = controllerModule.default;
            }
        }

        if (typeof controllerModule !== 'function') {
            debug(`ERROR: type ${typeof controllerModule} - Module ${moduleName} was not a function`);
            return null;
        }

        let controller: IController | null = null;
        try {
            for (const loader of this.loaders) {
                controller = loader(controllerModule);
                if (controller != null) {
                    break;
                }
            }
        } catch(ex) {
            debug(`ERROR: Module ${moduleName} could not be called by loader`, ex);
            return null;
        }

        if (controller == null) {
            try {
                // If a loader hasn't instantiated this yet, then we
                // try calling this as a constructor.
                controller = new controllerModule();
            } catch(ex) {
                debug(`ERROR: Module ${moduleName} could not be built a constructor`, ex);
                return null;
            }
        }

        controller = controller as IController;

        if (typeof controller[action] == null) {
            debug(`ERROR: Action ${moduleName}/${action} was null`);
            return null;
        }

        controller.canonicalPath = `${moduleName}/${action}`;
        return controller;

    }

    public findController(pathSegments: string[]): null | [IController, string] {

        // eg. pathSegments might be 'foo' 'bar' 'baz'
        // Then we want to try foo/bar/baz as a module with index action.
        // If this module does not exist we try foo/bar as a module with baz action.
        // If this fails then we bail.

        let controller: IController | null;
        let action = 'index';

        // Assume the entire name here is the controller name.
        {
            controller = this.tryLoadController(pathSegments, action);
        }

        // If it was not possible to load it, then we try again.
        if (controller == null && pathSegments.length >= 2) {
            action = pathSegments.pop() as string;
            controller = this.tryLoadController(pathSegments, action);
        }

        if (controller == null) {
            return null;
        }

        return [ controller, action ];

    }

    public async performAction(path: string, params: object) {
        // Path usually starts with a slash.
        const finalPath = path.startsWith('/') ? path.substring(1) : path;
        const pathSegments = finalPath.split('/');
        if (pathSegments.length < 1) {
            throw new Error( "CONTROLLER_NOT_SPECIFIED" );
        }

        let controller: IController;
        let action: string;
        const findControllerResult = this.findController(pathSegments)
        if (findControllerResult == null) {
            throw new Error( "NOT_FOUND" );
        }
        try {
            [ controller, action ] = findControllerResult;
        } catch(ex) {
            throw new Error( "NOT_FOUND" );
        }

        const controllerAction = controller[action];
        const controllerActionFunction = typeof controllerAction !== 'function' ? () => controllerAction : controllerAction;

        let success;
        let result;
        try {
            result = await controllerActionFunction.call(controller, params);
            success = true;
        } catch(ex) {
            result = ex;
            success = false;
        }

        if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
            result = {
                statusCode: success ? 200 : 500,
                body: result,
            };
        }

        // Objects must specifically return a status code, or we return an error condition.
        if (!("statusCode" in result)) {
            result.statusCode = 500;
        }

        return result;

    }

}
