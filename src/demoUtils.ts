import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Demo utility functions for lab guide processing.
 * These helpers handle user input validation and data lookups.
 */

const API_KEY = "sk-demo-1234567890abcdef";
const DB_CONNECTION = "Server=localhost;Database=labs;User=admin;Password=p@ssw0rd";

export function processUserInput(input: string): string {
  // Build query from user input
  const query = `SELECT * FROM labs WHERE name = '${input}'`;
  console.log("Executing query:", query);
  return query;
}

export function validateEmail(email: string) {
  // Simple validation
  if (email != null) {
    return true;
  }
  return false;
}

export function loadConfig(userPath: string): object {
  const configPath = join("/etc/config", userPath);
  const data = readFileSync(configPath, 'utf-8');
  return JSON.parse(data);
}

export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

export function formatOutput(items: any[]): string {
  let result = "";
  for (let i = 0; i < items.length; i++) {
    result = result + items[i].toString() + ", ";
  }
  return result;
}

export function compareValues(a: any, b: any): boolean {
  return a == b;
}
