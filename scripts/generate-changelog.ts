#!/usr/bin/env tsx
/**
 * scripts/generate-changelog.ts
 *
 * Manual changelog generation utility for html-to-pdf-lite-module.
 * Parses git commit history using Conventional Commits and updates CHANGELOG.md.
 *
 * Usage:
 *   npm run changelog [options]
 *   npx tsx scripts/generate-changelog.ts [options]
 *
 * Options:
 *   -d, --dry-run          Preview changelog in stdout without modifying CHANGELOG.md
 *   -v, --version <semver> Specify release version (e.g. 2.4.0)
 *   -u, --unreleased       Generate as [Unreleased] section
 *   --from <ref>           Start git ref/tag (default: latest git tag)
 *   --to <ref>             End git ref (default: HEAD)
 *   --date <YYYY-MM-DD>    Release date (default: today)
 *   --force                Overwrite existing version section in CHANGELOG.md if it exists
 *   --append               Append new entries to existing version section if it exists
 *   -a, --all              Generate changelog sections across all tags in repository
 *   -h, --help             Display help
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const packageJsonPath = path.join(rootDir, 'package.json');

// --- Helper Types ---

interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorName: string;
  date: string;
  type: string;
  scope?: string;
  isBreaking: boolean;
  description: string;
}

interface CategoryConfig {
  title: string;
  order: number;
}

const CATEGORY_MAP: Record<string, CategoryConfig> = {
  breaking: { title: '💥 Breaking Changes', order: 0 },
  feat: { title: '🚀 Features', order: 1 },
  fix: { title: '🐛 Bug Fixes', order: 2 },
  perf: { title: '⚡ Performance Improvements', order: 3 },
  refactor: { title: '🛠️ Code Refactoring', order: 4 },
  docs: { title: '📝 Documentation', order: 5 },
  test: { title: '🧪 Tests & Quality', order: 6 },
  build: { title: '📦 Build & Dependencies', order: 7 },
  ci: { title: '👷 CI/CD', order: 8 },
  chore: { title: '🔄 Chores & Maintenance', order: 9 },
  other: { title: '📌 Other Changes', order: 10 },
};

// --- Git Helpers ---

function runGit(command: string): string {
  try {
    return execSync(`git ${command}`, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function getRepoUrl(): string {
  const remoteUrl = runGit('config --get remote.origin.url');
  if (!remoteUrl) {
    return 'https://github.com/morvaivor/html-to-pdf-lite-module';
  }
  return remoteUrl
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
}

function getLatestTag(): string | null {
  const tags = runGit('tag -l --sort=-v:refname')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags[0] : null;
}

function getAllTagsDescending(): string[] {
  return runGit('tag -l --sort=-v:refname')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
}

function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return pkg.version || 'Unreleased';
  } catch {
    return 'Unreleased';
  }
}

// --- Commit Parser ---

const CONVENTIONAL_REGEX =
  /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s+(?<description>.+)/;

function parseCommits(fromRef?: string, toRef: string = 'HEAD'): CommitInfo[] {
  const range = fromRef ? `${fromRef}..${toRef}` : toRef;
  const delimiter = '---COMMIT_DELIMITER---';
  const format = `%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ad${delimiter}`;

  const raw = runGit(`log ${range} --pretty=format:"${format}" --date=short`);
  if (!raw) return [];

  const rawCommits = raw.split(delimiter).filter((c) => c.trim().length > 0);
  const commits: CommitInfo[] = [];

  for (const rawCommit of rawCommits) {
    const parts = rawCommit.trim().split('\x1f');
    if (parts.length < 6) continue;

    const [hash, shortHash, subject, body, authorName, date] = parts;

    // Skip automated merge commits
    if (/^Merge (pull request|branch)/i.test(subject)) {
      continue;
    }

    const match = subject.match(CONVENTIONAL_REGEX);
    let type = 'other';
    let scope: string | undefined;
    let isBreaking = false;
    let description = subject;

    if (match?.groups) {
      type = match.groups.type.toLowerCase();
      scope = match.groups.scope;
      isBreaking = !!match.groups.breaking;
      description = match.groups.description.trim();
    }

    if (
      body.includes('BREAKING CHANGE:') ||
      body.includes('BREAKING CHANGES:')
    ) {
      isBreaking = true;
    }

    commits.push({
      hash,
      shortHash,
      subject,
      body,
      authorName,
      date,
      type,
      scope,
      isBreaking,
      description,
    });
  }

  return commits;
}

// --- Markdown Formatter ---

function formatCommitLine(commit: CommitInfo, repoUrl: string): string {
  let desc = commit.description;

  // Link PR references: (#15) or #15 -> [#15](url)
  desc = desc.replace(/(?:^|\s|\()#(\d+)(?:\)|\b)/g, (full, prNum) => {
    const prefix = full.startsWith('(') ? '(' : full.startsWith(' ') ? ' ' : '';
    const suffix = full.endsWith(')') ? ')' : '';
    return `${prefix}[#${prNum}](${repoUrl}/pull/${prNum})${suffix}`;
  });

  const commitLink = `([${commit.shortHash}](${repoUrl}/commit/${commit.hash}))`;
  const scopePrefix = commit.scope ? `**${commit.scope}**: ` : '';

  return `- ${scopePrefix}${desc} ${commitLink}`;
}

function generateVersionSection(
  version: string,
  date: string,
  commits: CommitInfo[],
  repoUrl: string,
  compareTag?: string
): string {
  const isUnreleased = version.toLowerCase() === 'unreleased';
  let versionHeader: string;

  if (isUnreleased) {
    versionHeader = compareTag
      ? `## [Unreleased](${repoUrl}/compare/${compareTag}...HEAD)`
      : `## [Unreleased]`;
  } else if (compareTag) {
    versionHeader = `## [${version}](${repoUrl}/compare/${compareTag}...v${version}) - ${date}`;
  } else {
    versionHeader = `## [${version}] - ${date}`;
  }

  if (commits.length === 0) {
    return `${versionHeader}\n\n*No notable changes in this release.*\n`;
  }

  // Group commits by category
  const grouped: Record<string, CommitInfo[]> = {};

  for (const commit of commits) {
    let categoryKey = commit.type;
    if (commit.isBreaking) {
      categoryKey = 'breaking';
    } else if (!CATEGORY_MAP[categoryKey]) {
      categoryKey = 'other';
    }

    if (!grouped[categoryKey]) {
      grouped[categoryKey] = [];
    }
    grouped[categoryKey].push(commit);
  }

  // Sort categories according to CATEGORY_MAP order
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const orderA = CATEGORY_MAP[a]?.order ?? 99;
    const orderB = CATEGORY_MAP[b]?.order ?? 99;
    return orderA - orderB;
  });

  const lines: string[] = [versionHeader, ''];

  for (const catKey of sortedCategories) {
    const config = CATEGORY_MAP[catKey] || {
      title: `📌 ${catKey}`,
      order: 99,
    };
    lines.push(`### ${config.title}`);
    for (const commit of grouped[catKey]) {
      lines.push(formatCommitLine(commit, repoUrl));
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- File Update Logic ---

const CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) or [Release Please](https://github.com/googleapis/release-please) for automated commit specifications.
`;

interface UpdateOptions {
  dryRun: boolean;
  force: boolean;
  append: boolean;
}

function updateChangelogFile(
  newSection: string,
  version: string,
  options: UpdateOptions
): void {
  let existingContent = '';
  if (fs.existsSync(changelogPath)) {
    existingContent = fs.readFileSync(changelogPath, 'utf-8');
  }

  let finalContent: string;

  if (!existingContent.trim()) {
    finalContent = `${CHANGELOG_HEADER.trim()}\n\n${newSection.trim()}\n`;
  } else {
    // Check if section for version already exists (e.g. ## [2.3.0] or ## [Unreleased])
    const escapedVer = version.replace(/\./g, '\\.');
    const versionHeaderRegex = new RegExp(
      `^## \\[[v]?${escapedVer}(\\]|\\/|\\().*`,
      'm'
    );
    const hasExistingSection = versionHeaderRegex.test(existingContent);

    if (hasExistingSection) {
      if (options.append) {
        // Append new items to existing section
        const parts = existingContent.split(/\n(?=## \[[^\]]+\])/);
        const updatedParts = parts.map((part) => {
          if (versionHeaderRegex.test(part)) {
            // Strip the header from newSection and append content
            const contentLines = newSection.trim().split('\n').slice(1).join('\n').trim();
            return `${part.trim()}\n\n${contentLines}`;
          }
          return part;
        });
        finalContent = updatedParts.join('\n\n') + '\n';
      } else if (options.force) {
        // Replace existing version block up to the next version header
        const parts = existingContent.split(/\n(?=## \[[^\]]+\])/);
        const updatedParts = parts.map((part) => {
          if (versionHeaderRegex.test(part)) {
            return newSection.trim();
          }
          return part;
        });
        finalContent = updatedParts.join('\n\n') + '\n';
      } else {
        console.warn(
          `\n⚠️  Section for version [${version}] already exists in ${changelogPath}.`
        );
        console.warn(
          `   Existing notes were preserved to prevent accidental loss of curated release notes.`
        );
        console.warn(
          `   To overwrite, run with --force. To append, run with --append. Or specify --version <new-version>.\n`
        );
        return;
      }
    } else {
      // Insert after header
      const firstSectionIndex = existingContent.search(/\n## \[[^\]]+\]/);
      if (firstSectionIndex !== -1) {
        const header = existingContent.slice(0, firstSectionIndex).trim();
        const rest = existingContent.slice(firstSectionIndex).trim();
        finalContent = `${header}\n\n${newSection.trim()}\n\n${rest}\n`;
      } else {
        finalContent = `${existingContent.trim()}\n\n${newSection.trim()}\n`;
      }
    }
  }

  if (options.dryRun) {
    console.log('\n--- [DRY RUN] Generated Changelog Section ---');
    console.log(newSection);
    console.log('--- [DRY RUN] End of Section ---\n');
    console.log(
      `[DRY RUN] File ${changelogPath} would be updated for version [${version}].`
    );
  } else {
    fs.writeFileSync(changelogPath, finalContent, 'utf-8');
    console.log(`✅ Successfully updated ${changelogPath} for version [${version}]!`);
  }
}

// --- CLI Execution ---

function printHelp(): void {
  console.log(`
Manual Changelog Generator — html-to-pdf-lite-module

Usage:
  npm run changelog [options]
  npx tsx scripts/generate-changelog.ts [options]

Options:
  -d, --dry-run          Preview output in terminal without modifying CHANGELOG.md
  -v, --version <semver> Target release version (e.g. 2.4.0)
  -u, --unreleased       Generate as [Unreleased] section
  --from <tag/ref>       Starting git ref or tag (defaults to latest tag)
  --to <tag/ref>         Ending git ref (defaults to HEAD)
  --date <YYYY-MM-DD>    Date string to use in release header (defaults to today)
  --force                Overwrite existing version section in CHANGELOG.md if it exists
  --append               Append new entries to existing version section if it exists
  -a, --all              Regenerate changelog across all tags
  -h, --help             Display this help message

Examples:
  npm run changelog                      # Update CHANGELOG.md with commits since last tag
  npm run changelog:check                # Dry-run preview of pending changelog changes
  npm run changelog -- --version 2.4.0   # Generate specific version section (e.g. 2.4.0)
  npm run changelog -- --unreleased      # Generate/update [Unreleased] section
  npm run changelog -- --from 2.2.0      # Commits since tag 2.2.0
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }

  const dryRun = args.includes('-d') || args.includes('--dry-run');
  const allTagsMode = args.includes('-a') || args.includes('--all');
  const force = args.includes('--force');
  const append = args.includes('--append');
  const isUnreleasedMode = args.includes('-u') || args.includes('--unreleased');

  const versionIndex = args.findIndex((a) => a === '-v' || a === '--version');
  const explicitVersion = versionIndex !== -1 ? args[versionIndex + 1] : undefined;

  const fromIndex = args.findIndex((a) => a === '--from');
  const explicitFrom = fromIndex !== -1 ? args[fromIndex + 1] : undefined;

  const toIndex = args.findIndex((a) => a === '--to');
  const explicitTo = toIndex !== -1 ? args[toIndex + 1] : 'HEAD';

  const dateIndex = args.findIndex((a) => a === '--date');
  const explicitDate =
    dateIndex !== -1 ? args[dateIndex + 1] : new Date().toISOString().split('T')[0];

  const repoUrl = getRepoUrl();
  const latestTag = getLatestTag();
  const pkgVersion = getPackageVersion();

  console.log('📖 Manual Changelog Generator');
  console.log(`📦 Repository: ${repoUrl}`);
  console.log(`🏷️  Latest git tag: ${latestTag || 'none'}`);
  console.log(`📌 Package version: ${pkgVersion}`);

  if (allTagsMode) {
    const tagsDesc = getAllTagsDescending();
    console.log(`🔄 Regenerating changelog across all ${tagsDesc.length} tags...`);

    const sections: string[] = [CHANGELOG_HEADER.trim()];

    // Unreleased or pending commits above the latest tag
    if (tagsDesc.length > 0) {
      const topTag = tagsDesc[0];
      const pendingCommits = parseCommits(topTag, 'HEAD');
      if (pendingCommits.length > 0) {
        const targetVersion = isUnreleasedMode ? 'Unreleased' : (explicitVersion || pkgVersion);
        const topSection = generateVersionSection(
          targetVersion,
          explicitDate,
          pendingCommits,
          repoUrl,
          topTag
        );
        sections.push(topSection.trim());
      }
    }

    // Iterate through tags in descending order
    for (let i = 0; i < tagsDesc.length; i++) {
      const tag = tagsDesc[i];
      const prevTag = i + 1 < tagsDesc.length ? tagsDesc[i + 1] : undefined;
      const commits = parseCommits(prevTag, tag);
      const tagDate =
        runGit(`log -1 --format=%ad --date=short ${tag}`) || explicitDate;
      const section = generateVersionSection(
        tag,
        tagDate,
        commits,
        repoUrl,
        prevTag
      );
      sections.push(section.trim());
    }

    const fullContent = sections.join('\n\n') + '\n';
    if (dryRun) {
      console.log('\n--- [DRY RUN] Generated Full Changelog ---');
      console.log(fullContent);
    } else {
      fs.writeFileSync(changelogPath, fullContent, 'utf-8');
      console.log(`✅ Successfully regenerated ${changelogPath} for all tags!`);
    }
    return;
  }

  // Single release mode
  const fromRef = explicitFrom || latestTag || undefined;
  const toRef = explicitTo;

  let targetVersion: string;
  if (isUnreleasedMode) {
    targetVersion = 'Unreleased';
  } else if (explicitVersion) {
    targetVersion = explicitVersion;
  } else {
    // Check if package.json version is already present in CHANGELOG.md
    const existingContent = fs.existsSync(changelogPath)
      ? fs.readFileSync(changelogPath, 'utf-8')
      : '';
    const hasPkgVer = new RegExp(
      `^## \\[[v]?${pkgVersion.replace(/\./g, '\\.')}(\\]|\\/|\\().*`,
      'm'
    ).test(existingContent);

    if (hasPkgVer) {
      // The version in package.json is already documented in CHANGELOG.md.
      // Default to 'Unreleased' so we never accidentally overwrite curated release notes.
      targetVersion = 'Unreleased';
      console.log(
        `ℹ️  Version [${pkgVersion}] is already documented in CHANGELOG.md.`
      );
      console.log(
        `   Targeting [Unreleased] for pending commits. (Use --version <ver> to target a specific version).`
      );
    } else {
      targetVersion = pkgVersion;
    }
  }

  console.log(`🔍 Inspecting commits from ${fromRef || 'initial'} to ${toRef}...`);
  const commits = parseCommits(fromRef, toRef);
  console.log(`📝 Found ${commits.length} relevant commit(s).`);

  const section = generateVersionSection(
    targetVersion,
    explicitDate,
    commits,
    repoUrl,
    fromRef
  );

  updateChangelogFile(section, targetVersion, { dryRun, force, append });
}

main();
