# Opal

Opal is an app for organizing information. As a first order of business this means it's a notes app. But what's wrong with existing note apps? 

Nothing! I was a certified power user of Obsidian. But I wanted more, and plugins seemed insufficient. Also I wanted to build my own product, take pride in it, and tweak everything to my specific tastes. 

So first priority: a note-taker on-par with Obsidian or Evernote. 

<img width="1512" alt="Screenshot 2025-05-15 at 8 32 04 AM" src="https://github.com/user-attachments/assets/74ebdf10-6ef4-46ba-aa44-e8e6034707fa" />

It's not there yet, but perhaps not far off. Feature wise, the following are supported. 

- Create, edit, and delete notes
- Markdown support with live preview
- Light and dark theme
- Auto-save functionality
- Sidebar for quick note navigation
- Related notes suggestion

Aspirationally though, notes is just step 1. What's next? Photos. One of the shortfalls in Obsidian is photo management, and here I think taking inspiration from Lightroom (Classic) by supporting the "mounting" of directories from the OS Filesystem.

<img width="1512" alt="Screenshot 2025-05-15 at 8 50 32 AM" src="https://github.com/user-attachments/assets/becad0d8-8c3e-4560-8df5-dae9dddf64f1" />


Behind the scenes this creates a "virtual clone" in our virtual filesystem. The elegance of this solution, is users can mount arbitrary files (PDFs, Videos, etc). The dirty underbelly is the associated synchronization complexity.

Now we support arbitrary files, and we want to way to weave these throughout notes. Here, we take inspiration from Notion: nesting! 

This is WIP, but close. 

With nesting, we find ourselves with a rich graph data structure as well - fertile soil to plant some agentic LLMs. 

# Getting Started

## Prerequisites

- [`nvm` installed](https://formulae.brew.sh/formula/nvm)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/codyswain/opal.git && cd opal
```

2. Install Node.js dependencies:

```bash
nvm use && npm install
```

3. Set up Python virtual environment

```bash
python -m venv python_venv
```

4. Activate the Virtual Environment

On Windows:

```bash
python_venv\Scripts\activate
```

On macOS and Linux:

```bash
source python_venv/bin/activate
```

4. Install binaries required for python libraries:

On macOS:

```bash
brew install libomp openblas
```

5. Install Python Dependencies

```bash
pip install -r python_requirements.txt
```

## Running the Application

To start the application in development mode:

```bash
npm start
```

This will launch the Electron app with hot-reloading enabled.

## Building the Application

To build the application for production (this has not been tested):

```
npm run make
```

This will create distributable packages for your current platform in the `out` directory.

## Project Structure

- `src/`: Source files
  - `components/`: React components
  - `pages/`: Main application pages
  - `styles/`: Styled components and global styles
  - `main.ts`: Electron main process
  - `preload.ts`: Preload script for Electron
  - `renderer.tsx`: Entry point for React application
  - `tests/`: Unit and integration tests

## Testing

The application uses Vitest for testing the build processes and core functionality.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode during development
npm run test:watch 

# Run tests with UI
npm run test:ui

# Generate test coverage report
npm run test:coverage
```

### Pre-commit Hooks

The project uses Husky to run tests and linting before each commit to ensure code quality. This helps prevent introducing broken code into the repository.

### Continuous Integration

GitHub Actions are configured to run tests automatically on pull requests to the main branch. This helps ensure that all changes pass tests before they are merged.

## Technologies Used

- Electron
- React
- TypeScript
- Styled Components
- React Router
- React Markdown

## License

This project is licensed under the MIT License.
