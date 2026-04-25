#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── Config ─────────────────────────────────────────────────────────────────────

const API_KEY = process.env.CLOCKIFY_API_KEY ?? '';
const BASE_URL = (process.env.CLOCKIFY_BASE_URL ?? 'https://api.clockify.me/api/v1').replace(/\/+$/, '');

// ── HTTP helper ────────────────────────────────────────────────────────────────

async function api<T = any>(
    path: string,
    opts: { method?: string; body?: unknown; params?: Record<string, string | undefined> } = {},
): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (opts.params) {
        for (const [k, v] of Object.entries(opts.params)) {
            if (v !== undefined) url.searchParams.set(k, v);
        }
    }

    const res = await fetch(url.toString(), {
        method: opts.method ?? 'GET',
        headers: {
            'X-Api-Key': API_KEY,
            'Content-Type': 'application/json',
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Clockify API ${res.status}: ${text || res.statusText}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

function textResult(text: string, isError = false) {
    return { content: [{ type: 'text' as const, text }], isError };
}

// ── MCP Server ─────────────────────────────────────────────────────────────────

const server = new McpServer({
    name: 'Clockify',
    version: '1.0.0',
    title: 'Clockify Time Tracking',
    description: 'Manage Clockify workspaces, projects, and time entries.',
    icons: [{ src: 'https://raw.githubusercontent.com/andreasjhagen/Cynosure-MCPs/main/mcp-clockify/icon.png', mimeType: 'image/png' }],
});

// ── Workspace tools ────────────────────────────────────────────────────────────

server.registerTool(
    'list_workspaces',
    {
        description: 'List all Clockify workspaces accessible by the current user.',
    },
    async () => {
        try {
            const workspaces = await api<any[]>('/workspaces');
            const lines = workspaces.map(
                (w) => `• ${w.name} (ID: ${w.id})`,
            );
            return textResult(lines.length ? lines.join('\n') : 'No workspaces found.');
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

server.registerTool(
    'get_current_user',
    {
        description: 'Get info about the currently authenticated Clockify user, including their default workspace ID.',
    },
    async () => {
        try {
            const user = await api('/user');
            const lines = [
                `Name: ${user.name}`,
                `Email: ${user.email}`,
                `ID: ${user.id}`,
                `Default workspace: ${user.defaultWorkspace}`,
                `Active workspace: ${user.activeWorkspace}`,
                `Status: ${user.status}`,
            ];
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

// ── Project tools ──────────────────────────────────────────────────────────────

server.registerTool(
    'list_projects',
    {
        description: 'List projects in a Clockify workspace.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            name: z.string().optional().describe('Filter by project name (partial match)'),
            archived: z.boolean().optional().describe('If true, return only archived projects'),
            page: z.number().optional().describe('Page number (default: 1)'),
            pageSize: z.number().optional().describe('Page size (default: 50, max: 5000)'),
        },
    },
    async ({ workspaceId, name, archived, page, pageSize }) => {
        try {
            const projects = await api<any[]>(`/workspaces/${encodeURIComponent(workspaceId)}/projects`, {
                params: {
                    name,
                    archived: archived !== undefined ? String(archived) : undefined,
                    page: page !== undefined ? String(page) : undefined,
                    'page-size': pageSize !== undefined ? String(pageSize) : undefined,
                },
            });
            if (!projects.length) return textResult('No projects found.');
            const lines = projects.map(
                (p) =>
                    `• ${p.name} (ID: ${p.id})${p.archived ? ' [archived]' : ''}${p.clientName ? ` — Client: ${p.clientName}` : ''}`,
            );
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

server.registerTool(
    'get_project',
    {
        description: 'Get details of a specific Clockify project.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            projectId: z.string().describe('Project ID'),
        },
    },
    async ({ workspaceId, projectId }) => {
        try {
            const p = await api(`/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`);
            const lines = [
                `Name: ${p.name}`,
                `ID: ${p.id}`,
                `Billable: ${p.billable}`,
                `Public: ${p.public}`,
                `Archived: ${p.archived}`,
                `Color: ${p.color}`,
                p.clientName && `Client: ${p.clientName}`,
                p.note && `Note: ${p.note}`,
                `Duration: ${p.duration}`,
            ].filter(Boolean);
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

server.registerTool(
    'create_project',
    {
        description: 'Create a new project in a Clockify workspace.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            name: z.string().describe('Project name (2–250 chars)'),
            clientId: z.string().optional().describe('Client ID to associate'),
            isPublic: z.boolean().optional().describe('Whether the project is public (default: true)'),
            billable: z.boolean().optional().describe('Whether the project is billable'),
            color: z.string().optional().describe('Hex color (e.g., #FF0000)'),
            note: z.string().optional().describe('Project note'),
        },
    },
    async ({ workspaceId, name, clientId, isPublic, billable, color, note }) => {
        try {
            const body: Record<string, unknown> = { name };
            if (clientId !== undefined) body.clientId = clientId;
            if (isPublic !== undefined) body.isPublic = isPublic;
            if (billable !== undefined) body.billable = billable;
            if (color !== undefined) body.color = color;
            if (note !== undefined) body.note = note;

            const p = await api(`/workspaces/${encodeURIComponent(workspaceId)}/projects`, {
                method: 'POST',
                body,
            });
            return textResult(`Project created!\nName: ${p.name}\nID: ${p.id}`);
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

// ── Task tools ─────────────────────────────────────────────────────────────────

server.registerTool(
    'list_tasks',
    {
        description: 'List tasks on a Clockify project.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            projectId: z.string().describe('Project ID'),
            name: z.string().optional().describe('Filter by task name'),
            isActive: z.boolean().optional().describe('If true, only active tasks; if false, only done tasks'),
            page: z.number().optional().describe('Page number (default: 1)'),
            pageSize: z.number().optional().describe('Page size (default: 50)'),
        },
    },
    async ({ workspaceId, projectId, name, isActive, page, pageSize }) => {
        try {
            const tasks = await api<any[]>(
                `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/tasks`,
                {
                    params: {
                        name,
                        'is-active': isActive !== undefined ? String(isActive) : undefined,
                        page: page !== undefined ? String(page) : undefined,
                        'page-size': pageSize !== undefined ? String(pageSize) : undefined,
                    },
                },
            );
            if (!tasks.length) return textResult('No tasks found.');
            const lines = tasks.map(
                (t) => `• ${t.name} (ID: ${t.id}) — Status: ${t.status}`,
            );
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

server.registerTool(
    'create_task',
    {
        description: 'Create a new task on a Clockify project.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            projectId: z.string().describe('Project ID'),
            name: z.string().describe('Task name (1–1000 chars)'),
            assigneeIds: z.array(z.string()).optional().describe('List of user IDs to assign'),
            estimate: z.string().optional().describe('Time estimate in ISO-8601 duration (e.g., PT2H30M)'),
            status: z.enum(['ACTIVE', 'DONE']).optional().describe('Task status (default: ACTIVE)'),
        },
    },
    async ({ workspaceId, projectId, name, assigneeIds, estimate, status }) => {
        try {
            const body: Record<string, unknown> = { name };
            if (assigneeIds !== undefined) body.assigneeIds = assigneeIds;
            if (estimate !== undefined) body.estimate = estimate;
            if (status !== undefined) body.status = status;

            const t = await api(
                `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/tasks`,
                { method: 'POST', body },
            );
            return textResult(`Task created!\nName: ${t.name}\nID: ${t.id}\nStatus: ${t.status}`);
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

// ── Time entry tools ───────────────────────────────────────────────────────────

server.registerTool(
    'create_time_entry',
    {
        description:
            'Create a new time entry in Clockify. Provide start/end for a completed entry, or just start to begin a running timer.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            start: z.string().describe('Start time in ISO-8601 format (e.g., 2024-01-15T09:00:00Z)'),
            end: z.string().optional().describe('End time in ISO-8601 format. Omit to start a running timer.'),
            description: z.string().optional().describe('Time entry description detailing what was done'),
            projectId: z.string().optional().describe('Project ID to assign the entry to'),
            taskId: z.string().optional().describe('Task ID (must belong to the specified project)'),
            tagIds: z.array(z.string()).optional().describe('List of tag IDs'),
            billable: z.boolean().optional().describe('Whether the entry is billable'),
        },
    },
    async ({ workspaceId, start, end, description, projectId, taskId, tagIds, billable }) => {
        try {
            const body: Record<string, unknown> = { start };
            if (end !== undefined) body.end = end;
            if (description !== undefined) body.description = description;
            if (projectId !== undefined) body.projectId = projectId;
            if (taskId !== undefined) body.taskId = taskId;
            if (tagIds !== undefined) body.tagIds = tagIds;
            if (billable !== undefined) body.billable = billable;

            const entry = await api(`/workspaces/${encodeURIComponent(workspaceId)}/time-entries`, {
                method: 'POST',
                body,
            });
            const isRunning = !entry.timeInterval?.end;
            const lines = [
                `Time entry ${isRunning ? 'started (timer running)' : 'created'}!`,
                `ID: ${entry.id}`,
                entry.description && `Description: ${entry.description}`,
                entry.projectId && `Project: ${entry.projectId}`,
                entry.taskId && `Task: ${entry.taskId}`,
                `Start: ${entry.timeInterval?.start}`,
                entry.timeInterval?.end && `End: ${entry.timeInterval.end}`,
                entry.timeInterval?.duration && `Duration: ${entry.timeInterval.duration}`,
            ].filter(Boolean);
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

server.registerTool(
    'stop_timer',
    {
        description: 'Stop the currently running timer for a user.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            userId: z.string().describe('User ID (use get_current_user to find yours)'),
            end: z.string().optional().describe('End time in ISO-8601 format. Defaults to now.'),
        },
    },
    async ({ workspaceId, userId, end }) => {
        try {
            const body = { end: end ?? new Date().toISOString() };
            const entry = await api(
                `/workspaces/${encodeURIComponent(workspaceId)}/user/${encodeURIComponent(userId)}/time-entries`,
                { method: 'PATCH', body },
            );
            const lines = [
                'Timer stopped!',
                `ID: ${entry.id}`,
                entry.description && `Description: ${entry.description}`,
                `Start: ${entry.timeInterval?.start}`,
                `End: ${entry.timeInterval?.end}`,
                `Duration: ${entry.timeInterval?.duration}`,
            ].filter(Boolean);
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

server.registerTool(
    'get_time_entries',
    {
        description: 'Get time entries for a user in a Clockify workspace.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            userId: z.string().describe('User ID'),
            start: z.string().optional().describe('Filter: entries after this ISO-8601 datetime'),
            end: z.string().optional().describe('Filter: entries before this ISO-8601 datetime'),
            project: z.string().optional().describe('Filter by project ID'),
            description: z.string().optional().describe('Filter by description keyword'),
            page: z.number().optional().describe('Page number (default: 1)'),
            pageSize: z.number().optional().describe('Page size (default: 50)'),
        },
    },
    async ({ workspaceId, userId, start, end, project, description, page, pageSize }) => {
        try {
            const entries = await api<any[]>(
                `/workspaces/${encodeURIComponent(workspaceId)}/user/${encodeURIComponent(userId)}/time-entries`,
                {
                    params: {
                        start,
                        end,
                        project,
                        description,
                        page: page !== undefined ? String(page) : undefined,
                        'page-size': pageSize !== undefined ? String(pageSize) : undefined,
                    },
                },
            );
            if (!entries.length) return textResult('No time entries found.');
            const lines = entries.map((e) => {
                const dur = e.timeInterval?.duration || 'running';
                const desc = e.description || '(no description)';
                const proj = e.projectId ? ` [project: ${e.projectId}]` : '';
                return `• ${e.timeInterval?.start} — ${dur} — ${desc}${proj} (ID: ${e.id})`;
            });
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

server.registerTool(
    'update_time_entry',
    {
        description: 'Update an existing time entry in Clockify.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            timeEntryId: z.string().describe('Time entry ID'),
            start: z.string().describe('Start time in ISO-8601 format (required by Clockify even for partial updates)'),
            end: z.string().optional().describe('End time in ISO-8601 format'),
            description: z.string().optional().describe('Updated description'),
            projectId: z.string().optional().describe('Project ID to reassign to'),
            taskId: z.string().optional().describe('Task ID'),
            tagIds: z.array(z.string()).optional().describe('Updated list of tag IDs'),
            billable: z.boolean().optional().describe('Whether the entry is billable'),
        },
    },
    async ({ workspaceId, timeEntryId, start, end, description, projectId, taskId, tagIds, billable }) => {
        try {
            const body: Record<string, unknown> = { start };
            if (end !== undefined) body.end = end;
            if (description !== undefined) body.description = description;
            if (projectId !== undefined) body.projectId = projectId;
            if (taskId !== undefined) body.taskId = taskId;
            if (tagIds !== undefined) body.tagIds = tagIds;
            if (billable !== undefined) body.billable = billable;

            const entry = await api(
                `/workspaces/${encodeURIComponent(workspaceId)}/time-entries/${encodeURIComponent(timeEntryId)}`,
                { method: 'PUT', body },
            );
            return textResult(`Time entry updated!\nID: ${entry.id}\nStart: ${entry.timeInterval?.start}\nEnd: ${entry.timeInterval?.end || 'running'}\nDuration: ${entry.timeInterval?.duration || 'N/A'}`);
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

server.registerTool(
    'delete_time_entry',
    {
        description: 'Delete a time entry from a Clockify workspace.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            timeEntryId: z.string().describe('Time entry ID to delete'),
        },
    },
    async ({ workspaceId, timeEntryId }) => {
        try {
            await api(
                `/workspaces/${encodeURIComponent(workspaceId)}/time-entries/${encodeURIComponent(timeEntryId)}`,
                { method: 'DELETE' },
            );
            return textResult(`Time entry ${timeEntryId} deleted.`);
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

// ── Tag tools ──────────────────────────────────────────────────────────────────

server.registerTool(
    'list_tags',
    {
        description: 'List tags in a Clockify workspace.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            name: z.string().optional().describe('Filter by tag name'),
            page: z.number().optional().describe('Page number (default: 1)'),
            pageSize: z.number().optional().describe('Page size (default: 50)'),
        },
    },
    async ({ workspaceId, name, page, pageSize }) => {
        try {
            const tags = await api<any[]>(`/workspaces/${encodeURIComponent(workspaceId)}/tags`, {
                params: {
                    name,
                    page: page !== undefined ? String(page) : undefined,
                    'page-size': pageSize !== undefined ? String(pageSize) : undefined,
                },
            });
            if (!tags.length) return textResult('No tags found.');
            const lines = tags.map((t) => `• ${t.name} (ID: ${t.id})${t.archived ? ' [archived]' : ''}`);
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

// ── Client tools ───────────────────────────────────────────────────────────────

server.registerTool(
    'list_clients',
    {
        description: 'List clients in a Clockify workspace.',
        inputSchema: {
            workspaceId: z.string().describe('Workspace ID'),
            name: z.string().optional().describe('Filter by client name'),
            page: z.number().optional().describe('Page number (default: 1)'),
            pageSize: z.number().optional().describe('Page size (default: 50)'),
        },
    },
    async ({ workspaceId, name, page, pageSize }) => {
        try {
            const clients = await api<any[]>(`/workspaces/${encodeURIComponent(workspaceId)}/clients`, {
                params: {
                    name,
                    page: page !== undefined ? String(page) : undefined,
                    'page-size': pageSize !== undefined ? String(pageSize) : undefined,
                },
            });
            if (!clients.length) return textResult('No clients found.');
            const lines = clients.map(
                (c) => `• ${c.name} (ID: ${c.id})${c.archived ? ' [archived]' : ''}`,
            );
            return textResult(lines.join('\n'));
        } catch (err) {
            return textResult(`Error: ${(err as Error).message}`, true);
        }
    },
);

// ── Start ──────────────────────────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Clockify MCP server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
