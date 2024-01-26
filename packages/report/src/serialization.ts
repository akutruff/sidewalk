/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFile, writeFile } from "fs/promises";
import fs from "fs";

interface MapSerializationContainer {
    _dataType_reflect: 'Map',
    value: [unknown, unknown][]
}

function isMapSerializationContainer(value: unknown): value is MapSerializationContainer {
    return typeof value === 'object' && value !== null && (value as MapSerializationContainer)._dataType_reflect === 'Map';
}

function mapReplacer(value: unknown) {
    if (value instanceof Map) {
        return {
            _dataType_reflect: 'Map',
            value: [...value],
        } as MapSerializationContainer;
    } else {
        return value;
    }
}

function mapReviver(key: string, value: unknown) {
    if (isMapSerializationContainer(value)) {
        return new Map(value.value);
    }
    return value;
}

export function JSONStringifyWithMaps(value: unknown, replacer?: ((this: any, key: string, value: any) => any) | undefined, space?: string | number | undefined) {
    return JSON.stringify(value,
        function (this: any, key: string, value: any) {
            const replaced = mapReplacer(value);
            return replacer?.call(this, key, replaced) ?? replaced;
        },
        space);
}

export function JSONParseWithMaps(value: string) {
    return JSON.parse(value, mapReviver);
}

export async function readFileAsJson<T>(path: string) {
    return JSONParseWithMaps(await readFile(path, 'utf8')) as T;
}

export function writeFileAsJson(path: string, data: unknown) {
    return writeFile(path, JSONStringifyWithMaps(data, undefined, 2));
}

export function writeFileAsJsonSync(path: string, data: unknown) {
    return fs.writeFileSync(path, JSONStringifyWithMaps(data, undefined, 2));
}