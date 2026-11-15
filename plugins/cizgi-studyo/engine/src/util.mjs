/** Small helpers shared by the engine modules. */
import { readFileSync } from "node:fs";

/** Ids used everywhere (library entries, characters, shots). Same as the schema's `id`. */
export const ID_PATTERN = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

/**
 * Read a text file as UTF-8, dropping a leading BOM (Notepad / PowerShell add one).
 * @param {string} path
 * @returns {string}
 */
export function readText(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "");
}

/**
 * Read and parse a JSON file; errors name the file.
 * @param {string} path
 * @returns {unknown}
 */
export function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (err) {
    throw new Error(`cannot read ${path}: ${err.message}`);
  }
}

/**
 * Own-property lookup (never matches Object.prototype names such as "constructor").
 * @param {object} obj
 * @param {string} key
 * @returns {boolean}
 */
export function has(obj, key) {
  return obj != null && Object.hasOwn(obj, key);
}
