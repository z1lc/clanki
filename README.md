[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/jasperket-clanki-badge.png)](https://mseep.ai/app/jasperket-clanki)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# Clanki - Claude's Anki Integration

An MCP server that enables AI assistants like Claude to interact with Anki flashcard decks through the Model Context Protocol (MCP).

## Features

- Create and manage Anki decks
- Create basic flashcards with front/back content
- Create cloze deletion cards
- Update existing cards and cloze deletions
- Add and manage tags
- View deck contents and card information
- Full integration with AnkiConnect

## Prerequisites

- [Anki](https://apps.ankiweb.net/) installed and running
- [AnkiConnect](https://ankiweb.net/shared/info/2055492159) plugin installed in Anki
- Node.js 16 or higher

## Installation

1. Clone this repository:

```bash
git clone https://github.com/yourusername/clanki.git
cd clanki
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Setup

1. Make sure Anki is running and the AnkiConnect plugin is installed and enabled

2. Configure Claude for Desktop to use the server by editing `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clanki": {
      "command": "node",
      "args": ["/absolute/path/to/clanki/build/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/clanki` with the actual path to your clanki installation.

## Available Tools
Tools exist for searching across the collection as well as creating three types of notes: basic; interview question; and programming language function.

## Development

To modify or extend the server:

1. Make changes to `src/index.ts`
2. Rebuild with `npm run build`
3. Debug with `npx @modelcontextprotocol/inspector node build/index.js`

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Built with the [Model Context Protocol SDK](https://github.com/modelcontextprotocol)
- Integrates with [Anki](https://apps.ankiweb.net/) via [AnkiConnect](https://foosoft.net/projects/anki-connect/)
