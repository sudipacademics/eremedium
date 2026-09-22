import { useEffect, useState } from 'react';
import { api, AgencyTeamNode } from '../../api';
import './agents-portal.css';

function TreeNodes({ nodes }: { nodes: AgencyTeamNode[] }) {
  if (!nodes?.length) return null;
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="node">
            <strong>{node.full_name}</strong>
            <span className="agents-level-chip">{node.level_title || node.level}</span>
            <span className="muted">{node.status}</span>
          </div>
          <TreeNodes nodes={node.children || []} />
        </li>
      ))}
    </ul>
  );
}

export function AgentsTeamPage() {
  const [tree, setTree] = useState<AgencyTeamNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getAgencyTeam()
      .then((res) => setTree(res.data.tree || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load team'));
  }, []);

  if (error) return <div className="error">{error}</div>;

  return (
    <>
      <h1>Team tree</h1>
      <p className="muted">Pyramid downline — each level carries descending editable commission rates.</p>
      <section className="agents-panel agents-tree">
        {!tree.length ? <p className="muted">No team nodes yet.</p> : <TreeNodes nodes={tree} />}
      </section>
    </>
  );
}
