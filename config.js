// ══════════════════════════════════════════════
// ── 設定檔：Supabase 連線 & 全域常數 ──
// ══════════════════════════════════════════════

// 新竹巨城 Supabase 專案連線設定
const SUPA_URL  = "https://zsjizejodifntbjxdryb.supabase.co";
const SUPA_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpzaml6ZWpvZGlmbnRianhkcnliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NjQxOTgsImV4cCI6MjEwMTM0MDE5OH0.M3obaV-ueDdQhSmZZExsE5nIVSjSLYhjMg4WSy2y2MU";
const EDGE_BASE = "https://zsjizejodifntbjxdryb.functions.supabase.co";

// 預設亮度（0~1，對應 90%）
const DEFAULT_BRIGHTNESS = 0.9;

// EPSG:3826 TWD97 TM2 Zone 121 投影定義
proj4.defs("EPSG:3826", "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs");
