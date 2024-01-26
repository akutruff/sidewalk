
type Next = () => void | Promise<void>;

type Middleware<T> =
    (context: T, next: Next) => Promise<void> | void;

export class MiddlewareDispatcher<T> {

    middlewares: Middleware<T>[];

    constructor() {
        this.middlewares = [];
    }

    use(...mw: Middleware<T>[]): void {
        this.middlewares.push(...mw);
    }
    dispatch(context: T): Promise<void> {
        return invokeMiddlewares(context, this.middlewares)
    }
}

async function invokeMiddlewares<T>(context: T, middlewares: Middleware<T>[]): Promise<void> {

    if (!middlewares[0]) {
        return;
    }

    const mw = middlewares[0];

    return mw(context, async () => {
        await invokeMiddlewares(context, middlewares.slice(1));
    })
}