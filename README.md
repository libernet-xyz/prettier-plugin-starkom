# Prettier Plugin for Starkom

[Prettier](https://prettier.io) plugin for formatting [Starkom](https://starkom.io) source files.

## Installation

```sh
npm install --save-dev prettier @libernet/prettier-plugin-starkom
```

## Usage

### CLI

```sh
npx prettier --write '**/*.starkom'
```

### Configuration

Add the plugin to your Prettier config (e.g. `.prettierrc`):

```json
{
  "plugins": ["@libernet/prettier-plugin-starkom"]
}
```

Prettier will then pick it up automatically for `.starkom` files.

### VS Code

Install the
[Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
extension, add the plugin to your config as above, and optionally enable format-on-save:

```json
{
  "editor.formatOnSave": true,
  "[starkom]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```
