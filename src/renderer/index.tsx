import { createRoot } from 'react-dom/client';
import App from './components/App/App';

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<App />);
