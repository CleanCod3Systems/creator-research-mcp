import {
  AppConfig,
  DEFAULT_APP_CONFIG,
  expandHome,
  loadYamlConfigOrDefault,
  resolveConfigPathOrNull,
} from "@cleancod3/core";
import type { ContentProvider } from "@cleancod3/core";
import {
  AnalysisRepository,
  CommentsRepository,
  ContentRepository,
  GenerationRepository,
  IntelligenceRepository,
  MetricsRepository,
  ProfileRepository,
  SearchRepository,
  createDb,
  runMigrations,
} from "@cleancod3/db";
import {
  InstagramProvider,
  LinkedInProvider,
  LocalFileProvider,
  PdfProvider,
  TikTokProvider,
  TwitterProvider,
  WebProvider,
  YouTubeProvider,
} from "@cleancod3/providers";
import { dirname, isAbsolute, resolve } from "node:path";

export interface AppContext {
  config: AppConfig;
  db: ReturnType<typeof createDb>;
  analysisRepo: AnalysisRepository;
  intelligenceRepo: IntelligenceRepository;
  content: ContentRepository;
  providers: ContentProvider[];
}

let ctx: AppContext | null = null;
let searchRepo: SearchRepository | null = null;
let commentsRepo: CommentsRepository | null = null;
let genRepo: GenerationRepository | null = null;
let metricsRepo: MetricsRepository | null = null;
let profileRepo: ProfileRepository | null = null;
let intelligenceRepo: IntelligenceRepository | null = null;

export function getIntelligenceRepo(): IntelligenceRepository {
  getContext();
  if (!intelligenceRepo) throw new Error("contexto no inicializado");
  return intelligenceRepo;
}

export function getSearchRepo(): SearchRepository {
  getContext();
  if (!searchRepo) throw new Error("contexto no inicializado");
  return searchRepo;
}

export function getCommentsRepo(): CommentsRepository {
  getContext();
  if (!commentsRepo) throw new Error("contexto no inicializado");
  return commentsRepo;
}

export function getGenRepo(): GenerationRepository {
  getContext();
  if (!genRepo) throw new Error("contexto no inicializado");
  return genRepo;
}

export function getMetricsRepo(): MetricsRepository {
  getContext();
  if (!metricsRepo) throw new Error("contexto no inicializado");
  return metricsRepo;
}

export function getProfileRepo(): ProfileRepository {
  getContext();
  if (!profileRepo) throw new Error("contexto no inicializado");
  return profileRepo;
}

/** Single dependency assembly point. With no config/ directory on disk, uses embedded defaults (npx). */
export function getContext(): AppContext {
  if (ctx) return ctx;
  const configPath = resolveConfigPathOrNull("default.yaml");
  const config = loadYamlConfigOrDefault(configPath, AppConfig, DEFAULT_APP_CONFIG);
  const repoRoot = configPath ? dirname(dirname(configPath)) : process.cwd();
  const expanded = expandHome(config.storage.databasePath);
  const dbPath = isAbsolute(expanded) ? expanded : resolve(repoRoot, expanded);
  const db = createDb(dbPath);
  runMigrations(db);
  searchRepo = new SearchRepository(db);
  commentsRepo = new CommentsRepository(db);
  genRepo = new GenerationRepository(db);
  metricsRepo = new MetricsRepository(db);
  profileRepo = new ProfileRepository(db);
  intelligenceRepo = new IntelligenceRepository(db);
  profileRepo.consolidateCreators();
  profileRepo.backfillContentCreators();
  ctx = {
    config,
    db,
    analysisRepo: new AnalysisRepository(db),
    intelligenceRepo,
    content: new ContentRepository(db),
    // order = matching priority: specific providers first, web as the http catch-all
    providers: [
      new YouTubeProvider(),
      new TikTokProvider(),
      new InstagramProvider(),
      new TwitterProvider(),
      new LinkedInProvider(),
      new PdfProvider(),
      new LocalFileProvider(),
      new WebProvider(),
    ],
  };
  return ctx;
}
