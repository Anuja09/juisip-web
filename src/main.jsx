import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './JuiSipApp.jsx'; // Assuming you renamed the component in this file to App
import './index.css'; // This is the file where Tailwind is injected

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);