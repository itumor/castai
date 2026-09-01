import {
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface ResourceTableColumn<Row> {
  /** Stable identifier for the column. Used as the React key and testid slug. */
  key: string;
  /** Header label shown above the column. */
  header: string;
  /**
   * When provided, the column is sortable and the row value is used for
   * string-based ordering. Either this or `render` may be provided. If
   * `render` is given without `sortValue`, sorting is disabled for the
   * column.
   */
  sortValue?: (row: Row) => string | number | null | undefined;
  /** Custom cell renderer. */
  render?: (row: Row) => ReactNode;
  /** Optional fixed width class. */
  width?: string;
  /** Optional inline-style overrides for the <th> and <td>. */
  style?: React.CSSProperties;
}

export interface ResourceTableProps<Row> {
  columns: ResourceTableColumn<Row>[];
  data: Row[];
  keyField: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  emptyMessage?: string;
  filterPlaceholder?: string;
  initialSortKey?: string;
  initialSortDir?: 'asc' | 'desc';
}

type SortDir = 'asc' | 'desc';

function defaultRender(value: unknown): ReactNode {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function getCellText<Row>(
  column: ResourceTableColumn<Row>,
  row: Row,
): string {
  if (column.sortValue) {
    const v = column.sortValue(row);
    if (v === null || v === undefined) return '';
    return String(v);
  }
  if (column.render) {
    // Best-effort string extraction for sorting when no sortValue is set.
    // Skip sort if no sortValue is provided.
    return '';
  }
  const raw = (row as unknown as Record<string, unknown>)[column.key];
  return raw === null || raw === undefined ? '' : String(raw);
}

/**
 * Reusable sortable / filterable resource table.
 *
 * Click a header to toggle sort. Use the filter input to do a case-
 * insensitive substring match across all columns that expose a value.
 */
export default function ResourceTable<Row>({
  columns,
  data,
  keyField,
  onRowClick,
  emptyMessage = 'No resources found.',
  filterPlaceholder = 'Filter…',
  initialSortKey,
  initialSortDir = 'asc',
}: ResourceTableProps<Row>): JSX.Element {
  const [filter, setFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<string | null>(
    initialSortKey ?? null,
  );
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);

  const columnByKey = useMemo(() => {
    const map = new Map<string, ResourceTableColumn<Row>>();
    for (const c of columns) map.set(c.key, c);
    return map;
  }, [columns]);

  const filtered = useMemo<Row[]>(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((row) =>
      columns.some((col) =>
        getCellText(col, row).toLowerCase().includes(needle),
      ),
    );
  }, [columns, data, filter]);

  const sorted = useMemo<Row[]>(() => {
    if (!sortKey) return filtered;
    const col = columnByKey.get(sortKey);
    if (!col || !col.sortValue) return filtered;
    const sign = sortDir === 'asc' ? 1 : -1;
    const copy = filtered.slice();
    copy.sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * sign;
      }
      return String(av).localeCompare(String(bv)) * sign;
    });
    return copy;
  }, [filtered, sortKey, sortDir, columnByKey]);

  const handleSort = (key: string): void => {
    const col = columnByKey.get(key);
    if (!col || !col.sortValue) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  if (data.length === 0) {
    return (
      <div className="kv-resource-table" data-testid="resource-table">
        <div className="kv-resource-table__toolbar">
          <input
            type="search"
            className="kv-resource-table__filter"
            placeholder={filterPlaceholder}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-testid="resource-table-filter"
            disabled
          />
        </div>
        <div className="kv-resource-table__empty">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="kv-resource-table" data-testid="resource-table">
      <div className="kv-resource-table__toolbar">
        <input
          type="search"
          className="kv-resource-table__filter"
          placeholder={filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="resource-table-filter"
        />
        <span className="kv-resource-table__count" data-testid="resource-table-count">
          {sorted.length} of {data.length}
        </span>
      </div>
      <div className="kv-resource-table__scroll">
        <table className="kv-resource-table__table">
          <thead>
            <tr>
              {columns.map((col) => {
                const sortable = Boolean(col.sortValue);
                const active = sortKey === col.key;
                const indicator = !sortable
                  ? ''
                  : active
                  ? sortDir === 'asc'
                    ? ' ▲'
                    : ' ▼'
                  : ' ⇅';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={
                      sortable
                        ? 'kv-resource-table__th kv-resource-table__th--sortable'
                        : 'kv-resource-table__th'
                    }
                    style={col.style}
                    data-testid={`resource-table-th-${col.key}`}
                    data-sortable={sortable ? 'true' : 'false'}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="kv-resource-table__sort"
                        onClick={() => handleSort(col.key)}
                        aria-label={`Sort by ${col.header}`}
                        data-testid={`resource-table-sort-${col.key}`}
                      >
                        {col.header}
                        <span aria-hidden="true">{indicator}</span>
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  className="kv-resource-table__cell kv-resource-table__empty-row"
                  colSpan={columns.length}
                  data-testid="resource-table-empty"
                >
                  No rows match the current filter.
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const key = keyField(row);
                const clickable = Boolean(onRowClick);
                return (
                  <tr
                    key={key}
                    className={
                      clickable
                        ? 'kv-resource-table__row kv-resource-table__row--clickable'
                        : 'kv-resource-table__row'
                    }
                    data-testid="resource-table-row"
                    data-row-key={key}
                    onClick={clickable ? () => onRowClick!(row) : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onRowClick!(row);
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className="kv-resource-table__cell"
                        data-testid={`resource-table-cell-${col.key}`}
                      >
                        {col.render
                          ? col.render(row)
                          : defaultRender(
                              (row as unknown as Record<string, unknown>)[col.key],
                            )}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
