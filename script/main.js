const AUDIO_ROOT = "audio/";
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".webm"];
const ORDER_STORAGE_KEY = "audio-player-order-v1";

const playlistElement = document.getElementById("playlist");
const playerElement = document.getElementById("player");
const nowPlayingElement = document.getElementById("nowPlaying");
const statusElement = document.getElementById("status");
const playButton = document.getElementById("playBtn");
const stopButton = document.getElementById("stopBtn");
const refreshButton = document.getElementById("refreshBtn");

let tracks = [];
let currentIndex = -1;
let isStopped = true;

const audioRootUrl = new URL(AUDIO_ROOT, window.location.href);

const prettifyName = (path) => {
  const fileName = decodeURIComponent(path.split("/").pop() ?? path);
  return fileName.replace(/\.[^.]+$/, "");
};

const isAudioPath = (path) => AUDIO_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));

const normalizeAudioPath = (href, base) => {
  const url = new URL(href, base);

  if (url.origin !== window.location.origin) {
    return null;
  }

  if (!url.pathname.startsWith(audioRootUrl.pathname)) {
    return null;
  }

  return `${url.pathname.slice(audioRootUrl.pathname.length - AUDIO_ROOT.length)}${url.search}`;
};

async function crawlDirectory(relativePath = AUDIO_ROOT, seen = new Set()) {
  const dirUrl = new URL(relativePath, window.location.href);
  const canonicalKey = `${dirUrl.pathname}${dirUrl.search}`;

  if (seen.has(canonicalKey)) {
    return [];
  }
  seen.add(canonicalKey);

  let html;
  try {
    const response = await fetch(dirUrl.toString(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    html = await response.text();
  } catch (error) {
    throw new Error(
      `Cannot read "${relativePath}". Run with a static server that allows listing the audio directory. (${error.message})`,
    );
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));

  const nested = [];
  const found = [];

  for (const href of links) {
    if (!href || href.startsWith("?") || href.startsWith("#")) {
      continue;
    }

    const normalized = normalizeAudioPath(href, dirUrl);
    if (!normalized) {
      continue;
    }

    if (normalized.endsWith("/")) {
      nested.push(normalized);
    } else if (isAudioPath(normalized)) {
      found.push(normalized);
    }
  }

  for (const next of nested) {
    found.push(...(await crawlDirectory(next, seen)));
  }

  return found;
}

function applySavedOrder(paths) {
  const savedOrder = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) ?? "[]");
  const rank = new Map(savedOrder.map((p, index) => [p, index]));

  return [...paths].sort((a, b) => {
    const aRank = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.localeCompare(b);
  });
}

function saveOrder() {
  localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(tracks.map((track) => track.path)));
}

function setStatus(message) {
  statusElement.textContent = message;
}

function updateActiveTrack() {
  [...playlistElement.querySelectorAll(".track")].forEach((row, index) => {
    row.classList.toggle("active", index === currentIndex && !isStopped);
  });
}

function loadTrack(index, autoplay = true) {
  if (!tracks.length || index < 0 || index >= tracks.length) {
    return;
  }

  currentIndex = index;
  const track = tracks[currentIndex];

  playerElement.src = track.path;
  nowPlayingElement.textContent = `${track.title} (${track.path})`;
  updateActiveTrack();

  if (autoplay) {
    void playerElement.play();
  }
}

function stopPlayback() {
  isStopped = true;
  playerElement.pause();
  playerElement.currentTime = 0;
  nowPlayingElement.textContent = "Stopped";
  updateActiveTrack();
}

function playFromCurrentOrTop() {
  if (!tracks.length) {
    setStatus("No tracks available.");
    return;
  }

  isStopped = false;
  if (currentIndex < 0 || currentIndex >= tracks.length) {
    currentIndex = 0;
  }

  loadTrack(currentIndex, true);
}

function goToNextTrack() {
  if (!tracks.length) {
    return;
  }

  currentIndex = (currentIndex + 1) % tracks.length;
  loadTrack(currentIndex, !isStopped);
}

function reorderTracks(fromIndex, toIndex) {
  if (fromIndex === toIndex || Number.isNaN(fromIndex) || Number.isNaN(toIndex) || fromIndex < 0 || toIndex < 0) {
    return;
  }

  const [moved] = tracks.splice(fromIndex, 1);
  tracks.splice(toIndex, 0, moved);

  if (currentIndex === fromIndex) {
    currentIndex = toIndex;
  } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
    currentIndex -= 1;
  } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
    currentIndex += 1;
  }

  renderPlaylist();
  saveOrder();
}

function renderPlaylist() {
  playlistElement.innerHTML = "";

  tracks.forEach((track, index) => {
    const item = document.createElement("li");
    const row = document.createElement("div");
    row.className = "track";
    row.draggable = true;
    row.dataset.index = String(index);

    const title = document.createElement("div");
    title.className = "track__title";

    const strong = document.createElement("strong");
    strong.textContent = track.title;

    const pathLine = document.createElement("div");
    pathLine.className = "track__path";
    pathLine.textContent = track.path;

    title.append(strong, pathLine);

    const play = document.createElement("button");
    play.type = "button";
    play.className = "track__play";
    play.textContent = "Play";
    play.addEventListener("click", () => {
      isStopped = false;
      loadTrack(index, true);
    });

    row.append(title, play);
    item.appendChild(row);
    playlistElement.appendChild(item);

    row.addEventListener("dragstart", (event) => {
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", row.dataset.index ?? "");
      event.dataTransfer.effectAllowed = "move";
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
    });

    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });

    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromIndex = Number(event.dataTransfer?.getData("text/plain"));
      const toIndex = Number(row.dataset.index);
      reorderTracks(fromIndex, toIndex);
    });
  });

  updateActiveTrack();
}

async function loadTracks() {
  setStatus("Scanning audio folders...");
  try {
    const allFound = await crawlDirectory();
    const uniquePaths = [...new Set(allFound)].sort((a, b) => a.localeCompare(b));
    const orderedPaths = applySavedOrder(uniquePaths);

    tracks = orderedPaths.map((path) => ({ path, title: prettifyName(path) }));

    if (!tracks.length) {
      setStatus("No audio files found in ./audio.");
      playlistElement.innerHTML = "";
      return;
    }

    if (currentIndex >= tracks.length) {
      currentIndex = -1;
    }

    renderPlaylist();
    setStatus(`Loaded ${tracks.length} track${tracks.length === 1 ? "" : "s"}.`);
  } catch (error) {
    tracks = [];
    currentIndex = -1;
    renderPlaylist();
    setStatus(error.message);
  }
}

playButton.addEventListener("click", playFromCurrentOrTop);
stopButton.addEventListener("click", stopPlayback);
refreshButton.addEventListener("click", () => {
  void loadTracks();
});
playerElement.addEventListener("ended", goToNextTrack);

void loadTracks();
