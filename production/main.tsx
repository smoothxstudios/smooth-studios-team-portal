import {createRoot} from 'react-dom/client';
import {AccountGate} from './components/accounts';
import Workspace from './app/workspace';
import './app/globals.css';
createRoot(document.getElementById('root')!).render(<AccountGate><Workspace/></AccountGate>);
