import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });

void navigator.storage?.persist?.().catch(() => {});
