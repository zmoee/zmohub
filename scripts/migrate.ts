/**
 * ZmoHub 数据库迁移脚本
 * 将旧 Neon 数据库的所有数据迁移到新 Neon 数据库
 *
 * 执行方式: npx tsx scripts/migrate.ts
 */

import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 数据库连接配置
// ============================================================

/** 旧数据库连接串 */
const OLD_DATABASE_URL =
  'postgresql://neondb_owner:npg_qU2hrgXISCV3@ep-delicate-haze-a1f0cvod-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

/** 新数据库连接串 */
const NEW_DATABASE_URL =
  'postgresql://neondb_owner:npg_Cet6gN1djJxr@ep-crimson-bird-aoursyu9-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

// 创建两个数据库连接
const oldSql = neon(OLD_DATABASE_URL);
const newSql = neon(NEW_DATABASE_URL);

// ============================================================
// 辅助函数：拆分 SQL 为单条语句
// ============================================================

/**
 * 将包含多条语句的 SQL 文本拆分为单条语句数组
 * 正确处理 $$ 美元引号中的分号
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    if (!inDollarQuote) {
      // 检测 $$ 美元引号开始
      if (char === '$' && sql[i + 1] === '$') {
        inDollarQuote = true;
        dollarTag = '$$';
        current += '$$';
        i++; // 跳过下一个 $
        continue;
      }
      // 分号 = 语句结束
      if (char === ';') {
        const trimmed = current.trim();
        if (trimmed) {
          statements.push(trimmed);
        }
        current = '';
        continue;
      }
    } else {
      // 检测 $$ 美元引号结束
      if (char === '$' && sql[i + 1] === '$') {
        inDollarQuote = false;
        current += '$$';
        i++;
        continue;
      }
    }

    current += char;
  }

  // 处理最后一条语句
  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements;
}

// ============================================================
// 主迁移函数
// ============================================================

async function migrate() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     ZmoHub 数据库迁移工具               ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ----------------------------------------------------------
  // 第 1 步：在新数据库创建表结构
  // ----------------------------------------------------------
  console.log('📦 第 1 步：在新数据库创建表结构...');

  const initSqlPath = path.join(__dirname, '..', 'database', 'init.sql');
  const initSqlContent = fs.readFileSync(initSqlPath, 'utf-8');
  const statements = splitSqlStatements(initSqlContent);

  // 过滤掉末尾的 SELECT 消息语句
  const ddlStatements = statements.filter(
    (s) => !s.startsWith("SELECT '数据库初始化完成")
  );

  for (let i = 0; i < ddlStatements.length; i++) {
    const stmt = ddlStatements[i];
    try {
      // @neondatabase/serverless 要求使用 .query() 方法执行原始 SQL 字符串
      await newSql.query(stmt);
    } catch (err: any) {
      // 表和触发器已存在时可以忽略错误
      if (
        err.message?.includes('already exists') ||
        err.message?.includes('duplicate')
      ) {
        console.log(`  ⚠ 跳过已存在的对象（语句 ${i + 1}）`);
      } else {
        console.error(`  ✗ 执行语句 ${i + 1} 失败:`, err.message);
        console.error(`    语句: ${stmt.substring(0, 100)}...`);
        throw err;
      }
    }
  }

  console.log('  ✓ 表结构就绪\n');

  // ----------------------------------------------------------
  // 第 2 步：清除新数据库中的默认数据
  // ----------------------------------------------------------
  console.log('🗑  第 2 步：清除新数据库默认数据...');

  // 按外键依赖的逆序删除
  await newSql`DELETE FROM plugin_versions`;
  await newSql`DELETE FROM ad_config`;
  await newSql`DELETE FROM config`;
  await newSql`DELETE FROM plugins`;

  console.log('  ✓ 默认数据已清除\n');

  // ----------------------------------------------------------
  // 第 3 步：从旧数据库迁移数据到新数据库
  // ----------------------------------------------------------
  console.log('📋 第 3 步：迁移数据...\n');

  // --- 3a. config 表（单行配置） ---
  console.log('  迁移 config 表...');
  const oldConfig = await oldSql`SELECT * FROM config`;
  for (const row of oldConfig) {
    await newSql`
      INSERT INTO config (id, qq_group_name, qq_group_number, qq_group_link, site_name, site_description, created_at, updated_at)
      VALUES (${row.id}, ${row.qq_group_name}, ${row.qq_group_number}, ${row.qq_group_link}, ${row.site_name}, ${row.site_description}, ${row.created_at}, ${row.updated_at})
    `;
  }
  console.log(`  ✓ config: ${oldConfig.length} 行`);

  // --- 3b. ad_config 表 ---
  console.log('  迁移 ad_config 表...');
  const oldAdConfig = await oldSql`SELECT * FROM ad_config ORDER BY id`;
  for (const row of oldAdConfig) {
    await newSql`
      INSERT INTO ad_config (id, title, subtitle, enabled, created_at, updated_at)
      VALUES (${row.id}, ${row.title}, ${row.subtitle}, ${row.enabled}, ${row.created_at}, ${row.updated_at})
    `;
  }
  console.log(`  ✓ ad_config: ${oldAdConfig.length} 行`);

  // --- 3c. plugins 表 ---
  console.log('  迁移 plugins 表...');
  const oldPlugins = await oldSql`SELECT * FROM plugins ORDER BY id`;
  for (const row of oldPlugins) {
    await newSql`
      INSERT INTO plugins (id, name, description, download_url, category, install_guide, download_count, created_at, updated_at)
      VALUES (${row.id}, ${row.name}, ${row.description}, ${row.download_url}, ${row.category}, ${row.install_guide}, ${row.download_count}, ${row.created_at}, ${row.updated_at})
    `;
  }
  console.log(`  ✓ plugins: ${oldPlugins.length} 行`);

  // --- 3d. plugin_versions 表 ---
  console.log('  迁移 plugin_versions 表...');
  const oldVersions = await oldSql`SELECT * FROM plugin_versions ORDER BY id`;
  for (const row of oldVersions) {
    await newSql`
      INSERT INTO plugin_versions (id, plugin_id, version_number, name, description, download_url, category, install_guide, created_at)
      VALUES (${row.id}, ${row.plugin_id}, ${row.version_number}, ${row.name}, ${row.description}, ${row.download_url}, ${row.category}, ${row.install_guide}, ${row.created_at})
    `;
  }
  console.log(`  ✓ plugin_versions: ${oldVersions.length} 行\n`);

  // ----------------------------------------------------------
  // 第 4 步：重置自增序列
  // ----------------------------------------------------------
  console.log('🔢 第 4 步：重置自增序列...');

  // 重置序列：有数据时设为 max(id) 使 nextval = max+1；空表时设为 1 使 nextval = 1
  const pluginsMax = await newSql`SELECT MAX(id)::int AS max_id FROM plugins`;
  const versionsMax = await newSql`SELECT MAX(id)::int AS max_id FROM plugin_versions`;
  const adConfigMax = await newSql`SELECT MAX(id)::int AS max_id FROM ad_config`;

  const seqResets: Array<{ seq: string; maxId: number | null }> = [
    { seq: 'plugins_id_seq', maxId: pluginsMax[0].max_id },
    { seq: 'plugin_versions_id_seq', maxId: versionsMax[0].max_id },
    { seq: 'ad_config_id_seq', maxId: adConfigMax[0].max_id },
  ];

  for (const { seq, maxId } of seqResets) {
    if (maxId !== null && maxId > 0) {
      // 有数据：两参数 setval，is_called=true，nextval = max_id + 1
      await newSql`SELECT setval(${seq}, ${maxId})`;
    } else {
      // 空表：三参数 setval，is_called=false，nextval = 1
      await newSql.query(`SELECT setval('${seq}', 1, false)`);
    }
    console.log(`  ✓ ${seq}`);
  }
  console.log('');

  // ----------------------------------------------------------
  // 第 5 步：验证迁移结果
  // ----------------------------------------------------------
  console.log('✅ 第 5 步：验证迁移结果...\n');

  const countPlugins = await newSql`SELECT COUNT(*)::int AS count FROM plugins`;
  const countVersions = await newSql`SELECT COUNT(*)::int AS count FROM plugin_versions`;
  const countConfig = await newSql`SELECT COUNT(*)::int AS count FROM config`;
  const countAdConfig = await newSql`SELECT COUNT(*)::int AS count FROM ad_config`;

  console.log('  新数据库表行数：');
  console.log(`    plugins:          ${countPlugins[0].count}`);
  console.log(`    plugin_versions:  ${countVersions[0].count}`);
  console.log(`    config:           ${countConfig[0].count}`);
  console.log(`    ad_config:        ${countAdConfig[0].count}`);

  // 与旧数据库比对
  const oldCountPlugins = await oldSql`SELECT COUNT(*)::int AS count FROM plugins`;
  const oldCountVersions = await oldSql`SELECT COUNT(*)::int AS count FROM plugin_versions`;
  const oldCountConfig = await oldSql`SELECT COUNT(*)::int AS count FROM config`;
  const oldCountAdConfig = await oldSql`SELECT COUNT(*)::int AS count FROM ad_config`;

  console.log('\n  旧数据库表行数：');
  console.log(`    plugins:          ${oldCountPlugins[0].count}`);
  console.log(`    plugin_versions:  ${oldCountVersions[0].count}`);
  console.log(`    config:           ${oldCountConfig[0].count}`);
  console.log(`    ad_config:        ${oldCountAdConfig[0].count}`);

  // 校验
  const allMatch =
    countPlugins[0].count === oldCountPlugins[0].count &&
    countVersions[0].count === oldCountVersions[0].count &&
    countConfig[0].count === oldCountConfig[0].count &&
    countAdConfig[0].count === oldCountAdConfig[0].count;

  if (allMatch) {
    console.log('\n🎉 迁移成功！所有表行数与旧数据库完全一致。');
  } else {
    console.log('\n⚠️  警告：部分表行数不一致，请检查！');
  }
}

// 执行迁移
migrate().catch((err) => {
  console.error('\n❌ 迁移失败:', err);
  process.exit(1);
});
