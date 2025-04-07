# Tread

Notes

<img width="1512" alt="image" src="https://github.com/user-attachments/assets/fcab22f1-cd01-476a-be19-129e9a44231e">



## Features

- Create, edit, and delete notes
- Markdown support with live preview
- Light and dark theme
- Auto-save functionality
- Sidebar for quick note navigation
- Related notes suggestion
- Feed ?
- Infinitely nested abstract data structure ?

## Prerequisites

- [`nvm` installed](https://formulae.brew.sh/formula/nvm)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/codyswain/tread.git && cd tread
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
