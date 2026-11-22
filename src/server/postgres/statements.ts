/**
 * Compatibility for the fixed SQLite statements in NewsroomDatabase. Native
 * PostgreSQL and operator-entered SQL go through PostgresDatabase.query.
 */
function adaptNewsroomSql(text: string): string {
  const flags = new Set(['completed', 'isActive', 'isRead']);
  return text
    // The vocabulary query expects JSON text with the keywords array intact.
    .replace(/json_array\((json_extract\(data, '\$\.title'\), json_extract\(data, '\$\.summary'\)), json_extract\(data, '\$\.keywords'\)\)/g,
      "(json_build_array($1, data::json -> 'keywords'))::text")
    .replace(/\bjson_extract\(((?:[a-z_]\w*\.)?\w+),\s*'\$\.(\w+)'\)/gi, (_match, column: string, key: string) =>
      flags.has(key) ? `madar_json_flag(${column}, '${key}')` : `(${column}::json ->> '${key}')`)
    .replace(/\s+INDEXED BY idx_news_archive_updated\b/g, '')
    .replace(/\binstr\(/g, 'strpos(')
    .replace(/ AS ([a-z]\w*[A-Z]\w*)/g, ' AS "$1"')
    .replace(/\bCAST\(value AS INTEGER\)/g, 'CAST(value AS BIGINT)')
    .replace('SET value = CAST(value AS BIGINT) + 1', 'SET value = (CAST(value AS BIGINT) + 1)::text')
    .replace('FROM user_credentials WHERE email = ?', 'FROM user_credentials WHERE lower(email) = lower(?)')
    .replace(/\bLIKE ([?]|@like) ESCAPE '\\'/g, "ILIKE CAST($1 AS TEXT) COLLATE \"C\" ESCAPE '\\'")
    .replace('remote_path = COALESCE(excluded.remote_path, remote_path)', 'remote_path = COALESCE(excluded.remote_path, upload_copies.remote_path)')
    .replace("CASE WHEN state = 'DONE' THEN state ELSE 'PENDING' END", "CASE WHEN share_fetches.state = 'DONE' THEN share_fetches.state ELSE 'PENDING' END")
    .replace(/INSERT OR REPLACE INTO entity_history([\s\S]+?VALUES \(\?, \?, \?, \?, \?, \?, \?\))/,
      'INSERT INTO entity_history$1 ON CONFLICT (collection, entity_id, version) DO UPDATE SET ' +
      'data = excluded.data, changed_by = excluded.changed_by, changed_by_name = excluded.changed_by_name, changed_at = excluded.changed_at');
}

const sqlTokens = /--[^\r\n]*|\/\*[\s\S]*?\*\/|\$([a-z_]\w*)?\$[\s\S]*?\$\1\$|[eE]'(?:\\[\s\S]|''|[^'\\])*'|'(?:''|[^'])*'|"(?:\"\"|[^"])*"|@([a-z_]\w*)|\?/gi;

export function compilePostgresStatement(sql: string) {
  const named = new Map<string, number>();
  let positional = 0;
  const text = adaptNewsroomSql(sql).replace(sqlTokens, (token, _dollarQuote, name?: string) => {
    if (name) {
      if (!named.has(name)) named.set(name, named.size + 1);
      return '$' + named.get(name);
    }
    return token === '?' ? '$' + ++positional : token;
  });
  if (named.size && positional) throw new Error('Cannot mix named and positional PostgreSQL parameters');

  function bind(args: unknown[]): unknown[] {
    if (!named.size) {
      const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      if (values.length !== positional) throw new Error(`Expected ${positional} PostgreSQL parameters, received ${values.length}`);
      return values;
    }

    const source = args[0];
    if (args.length !== 1 || !source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('Expected an object of named PostgreSQL parameters');
    }
    return [...named.keys()].map(name => {
      if (!Object.hasOwn(source, name)) throw new Error(`Missing PostgreSQL parameter @${name}`);
      return (source as Record<string, unknown>)[name];
    });
  }

  return { text, bind };
}
