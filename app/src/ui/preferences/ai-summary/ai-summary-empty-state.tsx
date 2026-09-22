import * as React from 'react'

/**
 * Rendered when no AI summary provider has been configured yet.
 */
export const AISummaryEmptyState: React.FC = () => {
  return (
    <div className="empty-state">
      <p>
        No providers configured. Add your first provider to enable AI commit
        message generation.
      </p>
    </div>
  )
}
