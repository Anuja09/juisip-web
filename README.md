# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

-----------------

## JuiSip Cloud Kitchen App Setup Guide (Using Vite & Tailwind)

Clone repo: git clone https://github.com/Anuja09/juisip-web.git

This guide provides the necessary steps to install and configure Tailwind CSS in your existing Vite/React project, which will resolve the styling issues.

1. Core Dependency Installation
   We need to ensure all required packages for styling are installed. Run this command to install Tailwind CSS, PostCSS, and Autoprefixer as development dependencies.
```
npm install -D tailwindcss postcss autoprefixer
```
Note: If you haven't already, ensure you install the icon library: npm install lucide-react.

2. Initialize Tailwind Configuration (CRITICAL STEP) : 
The next step generates the two required configuration files: tailwind.config.js and postcss.config.js.

A. Verify Initialization Script:
Ensure your project's package.json file contains the following script definition:
```
"scripts": {
"dev": "vite",
"build": "vite build",
"lint": "eslint . --ext js,jsx --report-unused-disable-directives --max-warnings 0",
"preview": "vite preview",
"tailwind:init": "tailwindcss init -p"
},
```
B. Run the Initialization Script
Execute the script from your terminal. Since we used npm install previously, this command should now successfully find the executable:

```
npm run tailwind:init
```
This command will create two files in your project root: tailwind.config.js and postcss.config.js.

3. Configure File Scanning (tailwind.config.js) : You must tell Tailwind which files it needs to scan to find the utility classes you are using (this is essential for generating the final CSS).

Open tailwind.config.js and update the content array to look like this:

```
/** @type {import('tailwindcss').Config} */
export default {
// CRUCIAL: This tells Tailwind to scan all JSX, TSX, JS, and TS files inside the 'src' folder
// for classes like 'flex', 'bg-lime-500', etc.
content: [
"./index.html",
"./src/**/*.{js,ts,jsx,tsx}",
],
theme: {
extend: {},
},
plugins: [],
}
```

4. Inject Tailwind Directives (index.css) : Open your main CSS file (in your case, src/index.css which is imported in main.jsx) and ensure these three directives are at the very top:

@tailwind base;
@tailwind components;
@tailwind utilities;

These directives are what PostCSS uses to inject the generated Tailwind CSS into your application.

5. Run the App : After completing the steps above, start your development server. The styles should now be compiled correctly and visible in your browser.
```
npm run dev
```

## Steps followed to create the app
1. install nvm - 0.39.7
2. install node - v22.20.0
3. create vite_react application
```agsl
npm create vite@latest juisip-web
```
