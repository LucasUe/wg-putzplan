import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';

function Placeholder() {
  return <div className="p-4">WG-Putzplan wird eingerichtet ...</div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Placeholder />
  </React.StrictMode>,
);
