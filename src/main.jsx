import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './style.css';
import App from './App.jsx';
import UserApp from './user.jsx';
import CheckIn from './checkin.jsx';
createRoot(document.getElementById('root')).render(<BrowserRouter>{location.pathname.startsWith('/user') && !location.pathname.startsWith('/users') ? <UserApp /> : location.pathname.startsWith('/checkin/') ? <CheckIn token={location.pathname.split('/')[2]} /> : <App />}</BrowserRouter>);
