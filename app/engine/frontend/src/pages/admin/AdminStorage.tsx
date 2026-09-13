/**
 * src/pages/admin/AdminStorage.tsx
 */
import React from 'react';
import { PageHeader } from '../../components/ui/PageHeader';

export default function AdminStorage() {
  const paths = [
    { label: 'Checkpoints', path: '.crucible_checkpoints/', env: 'CRUCIBLE_CHECKPOINT_ROOT' },
    { label: 'Artifacts', path: '.crucible_artifacts/', env: 'CRUCIBLE_ARTIFACT_ROOT' },
    { label: 'Uploads', path: '.crucible_uploads/', env: 'CRUCIBLE_UPLOAD_TMP' },
    { label: 'Store (JSON)', path: '.crucible_store/', env: 'CRUCIBLE_STORE_ROOT' },
    { label: 'Audit Log', path: '.crucible_audit.jsonl', env: 'CRUCIBLE_AUDIT_LOG' },
    { label: 'Database', path: 'crucible.db', env: 'N/A' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Storage" subtitle="File system storage paths" breadcrumbs={[{ label: 'Admin' }, { label: 'Storage' }]} />
      <div className="page-body">
        <div style={{ maxWidth: 680 }}>
          <div className="panel" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr><th>Store</th><th>Path</th><th>Environment Variable</th></tr>
              </thead>
              <tbody>
                {paths.map(p => (
                  <tr key={p.label}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{p.label}</td>
                    <td className="mono">{p.path}</td>
                    <td className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{p.env}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, fontSize: '0.77rem', color: 'var(--text-muted)' }}>
            No remote storage (S3, GCS, Azure) is configured. All data is stored on the local filesystem.
          </div>
        </div>
      </div>
    </div>
  );
}
