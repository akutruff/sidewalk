/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MiddlewareDispatcher } from "./middleware.js";

interface LogContext {
    logger: Logger;
    message: any;
    optionalParams: any[];
    line: string;
    time: Date;

}
export class Logger {
    maxLogLines: number = process.env.MAX_LOGGING ? Number.parseInt(process.env.MAX_LOGGING) : 1000;
    logLines = new CircularQueue<string>(this.maxLogLines);

    onLog = new MiddlewareDispatcher<LogContext>();
    onLogError = new MiddlewareDispatcher<LogContext>();

    get wholeLog() {
        return [...this.logLines].join('\n');
    }

    toLogLine(message: any, ...optionalParams: any[]) {
        const line = [message, ...optionalParams].map(x => {
            return x instanceof Error ? x.toString() :
                typeof x === 'object' ? JSON.stringify(x, null, 2) : String(x)
        }).join(' ');

        if (this.logLines.isFull()) {
            this.logLines.dequeue();
        }

        this.logLines.enqueue(line);
        return {
            logger: this,
            message,
            optionalParams,
            line,
            time: new Date()
        };

    }

    clog(message: any, ...optionalParams: any[]) {
        const context = this.toLogLine(message, ...optionalParams);
        return this.onLog.dispatch(context);
    }

    cerror(message: any, ...optionalParams: any[]) {
        const context = this.toLogLine(message, ...optionalParams);
        return this.onLogError.dispatch(context);
    }
}

class CircularQueue<T> implements Iterable<T>{
    elements: (T | null)[] = [];
    length = 0;
    front = 0;

    constructor(public maxSize: number) {
        this.elements.length = maxSize;
    }
    isEmpty() {
        return this.length == 0;
    }

    isFull() {
        return this.length >= this.maxSize;
    }

    enqueue(element: T) {
        if (this.length >= this.maxSize) throw (new Error("Maximum length exceeded"))
        const back = (this.front + this.length) % this.maxSize;
        this.elements[back] = element;
        this.length++;
    }

    dequeue() {
        if (this.isEmpty()) throw (new Error("No elements in the queue"))
        const value = this.getFront();
        this.elements[this.front] = null;
        this.front = (this.front + 1) % this.maxSize;
        this.length--;
        return value;
    }

    getFront() {
        if (this.isEmpty()) throw (new Error("No elements in the queue"))
        return this.elements[this.front % this.maxSize];
    }

    *[Symbol.iterator](): Iterator<T> {
        for (let i = 0; i < this.length; i++) {
            yield this.elements[(this.front + i) % this.maxSize] as T;
        }
    }

    clear() {
        this.elements = [];
        this.length = 0;
        this.front = 0;
    }
}

export const log = new Logger();

log.onLog.use(({ message, optionalParams }, next) => {
    console.log(message, ...optionalParams);
    return next();
});

log.onLogError.use(({ message, optionalParams }, next) => {
    console.error(message, ...optionalParams);
    return next();
});