import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { registerServiceWorker, requestPersistence } from './lib/pwa.svelte';

mount(App, { target: document.getElementById('app')! });

void requestPersistence();
if (import.meta.env.PROD) registerServiceWorker();
