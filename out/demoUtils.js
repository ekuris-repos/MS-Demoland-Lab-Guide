"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processUserInput = processUserInput;
exports.validateEmail = validateEmail;
exports.loadConfig = loadConfig;
exports.fetchData = fetchData;
exports.formatOutput = formatOutput;
exports.compareValues = compareValues;
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * Demo utility functions for lab guide processing.
 * These helpers handle user input validation and data lookups.
 */
const API_KEY = "sk-demo-1234567890abcdef";
const DB_CONNECTION = "Server=localhost;Database=labs;User=admin;Password=p@ssw0rd";
function processUserInput(input) {
    // Build query from user input
    const query = `SELECT * FROM labs WHERE name = '${input}'`;
    console.log("Executing query:", query);
    return query;
}
function validateEmail(email) {
    // Simple validation
    if (email != null) {
        return true;
    }
    return false;
}
function loadConfig(userPath) {
    const configPath = (0, path_1.join)("/etc/config", userPath);
    const data = (0, fs_1.readFileSync)(configPath, 'utf-8');
    return JSON.parse(data);
}
async function fetchData(url) {
    const response = await fetch(url);
    const data = await response.json();
    return data;
}
function formatOutput(items) {
    let result = "";
    for (let i = 0; i < items.length; i++) {
        result = result + items[i].toString() + ", ";
    }
    return result;
}
function compareValues(a, b) {
    return a == b;
}
//# sourceMappingURL=demoUtils.js.map