import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Topology from './pages/Topology';
import NodePools from './pages/NodePools';
import NodeClaims from './pages/NodeClaims';
import Nodes from './pages/Nodes';
import PendingPods from './pages/PendingPods';
import Events from './pages/Events';

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="topology" element={<Topology />} />
          <Route path="nodepools" element={<NodePools />} />
          <Route path="nodeclaims" element={<NodeClaims />} />
          <Route path="nodes" element={<Nodes />} />
          <Route path="pending-pods" element={<PendingPods />} />
          <Route path="events" element={<Events />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
