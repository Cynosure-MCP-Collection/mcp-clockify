# @cynosure-mcp/clockify

MCP server for Clockify time tracking — manage workspaces, projects, tasks, and time entries.

## Installation

```bash
npx @cynosure-mcp/clockify
```

Or install globally:

```bash
npm install -g @cynosure-mcp/clockify
clockify
```

## Tools

| Tool                | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `list_workspaces`   | List all accessible Clockify workspaces                          |
| `get_current_user`  | Get authenticated user info                                      |
| `list_projects`     | List projects in a workspace (supports filtering and pagination) |
| `get_project`       | Get details of a specific project                                |
| `create_project`    | Create a new project in a workspace                              |
| `list_tasks`        | List tasks on a project                                          |
| `create_task`       | Create a task on a project                                       |
| `create_time_entry` | Create or start a time entry                                     |

## Configuration

| Variable            | Required | Description                                              |
| ------------------- | -------- | -------------------------------------------------------- |
| `CLOCKIFY_API_KEY`  | Yes      | API key from Clockify Profile Settings → API             |
| `CLOCKIFY_BASE_URL` | No       | API base URL (default: `https://api.clockify.me/api/v1`) |

## MCP Config

```json
{
  "mcpServers": {
    "clockify": {
      "command": "npx",
      "args": ["@cynosure-mcp/clockify"],
      "env": {
        "CLOCKIFY_API_KEY": "your-api-key"
      }
    }
  }
}
```

## License

MIT
