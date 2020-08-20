interface IController {
    canonicalPath: string;
    [action: string]: string | object | ((params: object) => object);
}

type Loader = null | ((module: any) => IController);

export class Mvc {

    appRoot: string;

    loader?: Loader;

    constructor(appRoot: string) {
        this.appRoot = appRoot;
    }

    setLoader(fn: Loader) {
        this.loader = fn;
    }

    tryLoadController(pathSegments: string[], action: string): IController | null {

        const moduleName = pathSegments.join('/');
        const path = this.appRoot + '/' + moduleName;

        let controllerModule;
        try {
            controllerModule = require(path);
            console.log(`Module ${moduleName} loaded`);
        } catch(ex) {
            console.log(`Module ${path} not found`);
            return null;
        }

        if (typeof controllerModule !== 'function') {
            console.log('type', typeof controllerModule);
            console.log(`Module ${moduleName} was not a function`);
            return null;
        }

        let controller: IController;
        try {
            controller = this.loader != null ? this.loader(controllerModule) : new controllerModule();
        } catch(ex) {
            console.log(`Module ${moduleName} could not be called by loader or as a constructor`, ex);
            return null;
        }

        if (typeof controller[action] == null) {
            console.log(`Action ${moduleName}/${action} was null`);
            return null;
        }

        controller.canonicalPath = `${moduleName}/${action}`;
        return controller;

    }

    findController(pathSegments: string[]): null | [IController, string] {

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

    async performAction(path: string, params: object) {
        // Path usually starts with a slash.
        const finalPath = path.startsWith('/') ? path.substring(1) : path;
        const pathSegments = finalPath.split('/');
        if (pathSegments.length < 1) {
            throw "CONTROLLER_NOT_SPECIFIED";
        }

        let controller: IController;
        let action: string;
        const findControllerResult = this.findController(pathSegments)
        if (findControllerResult == null) {
            return "NOT_FOUND";
        }
        try {
            [ controller, action ] = findControllerResult;
        } catch(ex) {
            throw "NOT_FOUND";
        }

        let controllerAction = controller[action];
        let controllerActionFunction = typeof controllerAction !== 'function' ? () => controllerAction : controllerAction;

        let success;
        let result;
        try {
            result = await controllerActionFunction(params);
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