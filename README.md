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

Aspirationally though, notes is just step 1. What's next? Photos. One of the shortfalls in Obsidian is photo management, and here I think taking inspiration from Lightroom (Classic) and enabling "mounting" provides a beautiful solution.

<img width="1512" alt="Screenshot 2025-05-15 at 8 32 04 AM" src="https://github.com/user-attachments/assets/f7976589-9d86-4177-b68a-35dad6a79830" />

We're mounting a folder with images (which behind the scenes creates a "virtual clone", and providing a bridge between our virtual file system and the OS filesystem. This solution feels elegant because it extends to other file types. The dirty underbelly is the associated synchronization complexity that comes alongside. 

Now with a bridge between Virtual FS and OS FS, we need to a way to connect this information across your notes. Here, we take inspiration from Notion: nesting! 

This is currently a WIP (but very close). With nesting we start to build out a rich graph data structure. And this provides fertile soil to plant LLMs. More to come. 


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
