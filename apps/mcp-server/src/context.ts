import {
  AppConfig,
  DEFAULT_APP_CONFIG,
  expandHome,
  loadYamlConfigOrDefault,
  resolveConfigPathOrNull,
} from "@creator-research/core";
import type { ContentProvider } from "@creator-research/core";
import {
  AnalysisRepository,
  CacheRepository,
  CommentsRepository,
  ContentRepository,
  GenerationRepository,
  HeartbeatRepository,
  MetricsRepository,
  ProfileRepository,
  SearchRepository,
  SqliteJobQueue,
  createDb,
  runMigrations,
} from "@creator-research/db";
import {
  InstagramProvider,
  LinkedInProvider,
  LocalFileProvider,
  PdfProvider,
  TikTokProvider,
  TwitterProvider,
  WebProvider,
  YouTubeProvider,
} from "@creator-research/providers";
import { dirname, isAbsolute, resolve } from "node:path";

export interface AppContext {
  config: AppConfig;
  queue: SqliteJobQueue;
  analysisRepo: AnalysisRepository;
  cache: CacheRepository;
  content: ContentRepository;
  heartbeat: HeartbeatRepository;
  providers: ContentProvider[];
}

let ctx: AppContext | null = null;
let searchRepo: SearchRepository | null = null;
let commentsRepo: CommentsRepository | null = null;
let genRepo: GenerationRepository | null = null;
let metricsRepo: MetricsRepository | null = null;
let profileRepo: ProfileRepository | null = null;

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

/** Ensamblaje único de dependencias. Sin config/ en disco usa defaults embebidos (npx). */
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
  ctx = {
    config,
    queue: new SqliteJobQueue(db),
    analysisRepo: new AnalysisRepository(db),
    cache: new CacheRepository(db),
    content: new ContentRepository(db),
    heartbeat: new HeartbeatRepository(db),
    // orden = prioridad de matching: específicos primero, web como catch-all http
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
