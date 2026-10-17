import {createRoot} from 'react-dom/client';
import {AccountGate} from './components/accounts';
import Workspace from './app/workspace';
import {ProductionTheme} from './components/production-chrome';
import './app/globals.css';
import './app/dashboard-ui.css';
createRoot(document.getElementById('root')!).render(<ProductionTheme><AccountGate><Workspace/></AccountGate></ProductionTheme>);
