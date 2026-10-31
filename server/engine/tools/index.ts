export type { Tool, ToolContext, ToolResult } from './types.js';
export { MAX_OUTPUT, truncate, toolDefs, resolveInside } from './types.js';
export { readTools } from './fs-read.js';
export { writeTools } from './fs-write.js';
export { runCommandTool, DEFAULT_TIMEOUT_MS } from './shell.js';
export { fetchUrlTool, webSearchTool } from './web.js';

import type { Tool } from './types.js';
import { readTools } from './fs-read.js';
import { writeTools } from './fs-write.js';
import { runCommandTool } from './shell.js';
import { fetchUrlTool, webSearchTool } from './web.js';

export function allTools(cwd: string): Tool[] {
  return [...readTools(cwd), ...writeTools(cwd), runCommandTool(cwd), fetchUrlTool(), webSearchTool()];
}
