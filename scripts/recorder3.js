const { launch, getStream, wss } = require('puppeteer-stream');
const path = require('path');
const fs = require('fs');
const os = require('os');

class ShmotimeRecorder {
  constructor(options = {}) {
    // Selectors for UI elements
    this.SLATE_BUTTON_SELECTORS = [
      '.slate-ready',
      '.start-button',
      '[data-action="start"]',
      '#play-button',  // Shmotime iframe player
      '#play-overlay',  // Shmotime overlay container
      '.play-content-wrapper',  // Shmotime wrapper
      'iframe',  // Fallback: click iframe directly
    ];
    this.TEXT_BUTTON_SELECTORS_LOWERCASE = ['start', 'begin', 'play'];
    this.SLATE_CONTAINER_SELECTORS = [
        '.slate',
        '.slate-container',
        '.player-container',
        '.play-content-wrapper',
        'iframe',
    ];
    this.SLATE_WAIT_SELECTOR = '.slate-ready, .slate-loading, #play-button, #play-overlay, .play-content-wrapper, iframe';
    this.DIALOGUE_TEXT_SELECTORS = [
        '.now-playing-container[data-field="dialogue_line"] .now-playing-text',
        '.dialogue-text'
    ];

    this.options = {
      headless: false,
      record: true,
      verbose: true,
      outputDir: './episodes',
      waitTimeout: 60000,
      outputFormat: 'mp4',
      exportData: true,
      stopRecordingAt: 'end_credits',
      fixFrameRate: true,
      videoWidth: 1920,
      videoHeight: 1080,
      frameRate: 30,
      episodeData: null, // NEW: Episode metadata for filename generation
      muteAudio: false, // NEW: Mute audio during recording
      filenameSuffix: '', // NEW: Optional suffix for filename
      dateOverride: '', // NEW: Override date for output filenames
      baseName: '', // NEW: Canonical base name for all output files
      ...options
    };

    this.browser = null;
    this.page = null;
    this.stream = null;
    this.outputFile = null;
    this.episodeInfo = null;
    this.navigationMonitor = null;
    this.endDetected = false;
    this.recordingStopped = false;
    this.showConfig = null;
    this.episodeData = null;
    this.recorderEvents = [];
    this.currentPhase = 'waiting';
    this.ffmpegPromise = null; // Add a property to hold the ffmpeg promise
  }

  /**
   * Detects and returns the correct frame context for the player.
   * Shmotime episode pages embed the player in an iframe (stageshat/index.html).
   */
  async getPlayableFrame() {
    const frames = this.page.frames();

    // Look for the player iframe (stageshat or stage)
    for (const frame of frames) {
      const url = frame.url();
      if (url.includes('stageshat') || url.includes('/stage')) {
        return frame;
      }
    }

    // No iframe found, use main page
    return this.page.mainFrame();
  }

  getChromePath() {
    const platform = os.platform();
    if (platform === 'win32') {
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else if (platform === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (platform === 'linux') {
      const possiblePaths = [
        '/snap/bin/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
      ];
      for (const chromePath of possiblePaths) {
        if (fs.existsSync(chromePath)) return chromePath;
      }
      return '/snap/bin/chromium';
    }
    return '';
  }

  async fixVideoFrameRateWithFfmpeg() {
    const log = this.log.bind(this); 
    if (!this.outputFile?.path || !this.options.fixFrameRate) {
        log('Skipping ffmpeg frame rate fix (no input file or option disabled).', 'debug');
        return null;
    }
    
    const inputFile = this.outputFile.path;
    const targetFrameRate = this.options.frameRate;
    const outputPath = inputFile.replace(/(\.\w+)$/, `_fps${targetFrameRate}.mp4`); // Output as MP4

    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      log(`Post-processing video to ${targetFrameRate}fps MP4: ${outputPath}`);
      log(`Input: ${inputFile}`);
      
      // Re-encode to H.264 video and AAC audio for MP4 compatibility
      const ffmpegCmd = `ffmpeg -i "${inputFile}" -r ${targetFrameRate} -c:v libx264 -preset medium -crf 23 -c:a aac -strict experimental -b:a 192k -y "${outputPath}"`;
      
      const { stdout, stderr } = await execAsync(ffmpegCmd);
      if (stderr && this.options.verbose) {
          log(`FFmpeg stderr: ${stderr}`, 'debug');
      }
      
      log(`Video processed to MP4: ${outputPath}`);
      return outputPath;
      
    } catch (error) {
      log(`Error processing video with ffmpeg: ${error.message}`, 'error');
      log('You can manually process with a command like:', 'info');
      log(`ffmpeg -i "${inputFile}" -r ${targetFrameRate} -c:v libx264 -c:a aac -strict experimental "${outputPath}"`, 'info');
      return null;
    }
  }

  processShowConfig(showConfig) {
    this.log('Processing show config data...');
    this.showConfig = {
      description: showConfig.description || '',
      id: showConfig.id || '',
      creator: showConfig.creator || '',
      image: showConfig.image || false,
      image_thumb: showConfig.image_thumb || false,
      actors: {},
      locations: {}
    };

    if (showConfig.actors) {
      Object.keys(showConfig.actors).forEach(actorId => {
        const actor = showConfig.actors[actorId];
        this.showConfig.actors[actorId] = {
          description: actor.description || '',
          elevenlabs_voice_id: actor.elevenlabs_voice_id || '',
          image: actor.image || '',
          image_thumb: actor.image_thumb || '',
          name: actor.title || ''
        };
      });
    }

    if (showConfig.locations) {
      Object.keys(showConfig.locations).forEach(locationId => {
        const location = showConfig.locations[locationId];
        this.showConfig.locations[locationId] = {
          description: location.description || '',
          image: location.image || '',
          image_thumb: location.image_thumb || '',
          name: location.title || '',
          slots: {
            north_pod: location.slots?.north_pod || '',
            south_pod: location.slots?.south_pod || '',
            east_pod: location.slots?.east_pod || '',
            west_pod: location.slots?.west_pod || '',
            center_pod: location.slots?.center_pod || ''
          }
        };
      });
    }

    this.log(`Processed show config: ${Object.keys(this.showConfig.actors).length} actors, ${Object.keys(this.showConfig.locations).length} locations`);
  }

  processEpisodeData(episodeData) {
    this.log('Processing episode data...');
    this.episodeData = {
      id: episodeData.id || '',
      name: episodeData.title || '',
      image: episodeData.image || false,
      image_thumb: episodeData.image_thumb || false,
      premise: episodeData.premise || '',
      scenes: []
    };

    if (episodeData.scenes && Array.isArray(episodeData.scenes)) {
      this.episodeData.scenes = episodeData.scenes.map(scene => ({
        description: scene.description || '',
        totalInScenes: scene.totalInScenes || 0,
        transitionIn: scene.transitionIn || '',
        transitionOut: scene.transitionOut || '',
        cast: {
          center_pod: scene.cast?.center_pod || undefined,
          east_pod: scene.cast?.east_pod || undefined,
          north_pod: scene.cast?.north_pod || undefined,
          south_pod: scene.cast?.south_pod || undefined,
          west_pod: scene.cast?.west_pod || undefined
        },
        location: scene.location || '',
        dialogue: (scene.dialogues || []).map(dialogue => ({
          number: dialogue.number || 0,
          totalInScenes: dialogue.totalInScenes || 0,
          action: dialogue.action || '',
          line: dialogue.line || '',
          actor: dialogue.actor || ''
        })),
        length: scene.length || 0,
        number: scene.number || 0,
        totalInEpisode: scene.totalInEpisode || 0,
        total_dialogues: scene.total_dialogues || 0
      }));
    }

    this.log(`Processed episode data: ${this.episodeData.scenes.length} scenes`);
    
    // Update filename now that we have episode data
    this.updateFilenameWithEpisodeData();
  }

  updateFilenameWithEpisodeData() {
    // No-op: baseName is set once and never mutated
    return;
  }

  async stopRecording() {
    if (this.stream && !this.recordingStopped) {
      try {
        this.log('Stopping recording immediately...');
        this.recordingStopped = true;
        await this.stream.destroy();
        this.log('Recording stopped');
        this.log(`Video saved to: ${this.outputFile?.path || "unknown path"}`);
        
        if (this.outputFile) this.outputFile.end();

        if (this.options.fixFrameRate && this.outputFile?.path) {
          this.ffmpegPromise = this.fixVideoFrameRateWithFfmpeg();
        }

        // Note: Browser closing is handled by close() method after ffmpeg completes

      } catch (error) {
        this.log(`Error stopping recording: ${error.message}`, 'error');
      }
    }
  }

  handleRecorderEvent(eventType, eventData = null) {
    const timestamp = new Date().toISOString();
    this.log(`Recorder event: ${eventType}`);
    
    this.recorderEvents.push({
      type: eventType,
      timestamp,
      data: eventData
    });

    // Handle phase transitions
    switch (eventType) {
      case 'load_show':
        if (eventData) this.processShowConfig(eventData);
        break;
      case 'load_episode':
        if (eventData) this.processEpisodeData(eventData);
        this.episodeStartTime = Date.now(); // Track when episode data loads
        break;
      case 'start_intro':
        this.currentPhase = 'intro';
        break;
      case 'end_intro':
        this.currentPhase = 'waiting';
        break;
      case 'start_ep':
        this.currentPhase = 'episode';
        this.episodePlaybackStartTime = Date.now(); // Track when actual playback starts
        break;
      case 'end_ep':
        this.currentPhase = 'waiting';
        this.log(`Episode playback ended - checking if this should trigger recording stop`);
        // If we're waiting for end_credits but episode ended, this might be our cue
        if (this.options.stopRecordingAt === 'end_credits' && this.currentPhase === 'waiting') {
          this.log(`*** Fallback: Episode ended but no credits detected, using end_ep as stop trigger ***`);
          this.endDetected = true;
          setTimeout(() => this.stopRecording(), 100);
        }
        break;
      case 'episode_end': // Handle this variant of episode end
        this.currentPhase = 'ended';
        this.log(`*** Episode completion detected via episode_end event ***`);
        this.log('Adding 3-second buffer before stopping recording...');
        this.endDetected = true;
        if (this.navigationMonitor) {
          clearInterval(this.navigationMonitor);
          this.navigationMonitor = null;
        }
        setTimeout(() => this.stopRecording(), 3000);
        break;
      case 'start_credits':
        this.currentPhase = 'credits';
        break;
      case 'end_credits':
        this.currentPhase = 'waiting';
        break;
      case 'start_postcredits':
        this.currentPhase = 'postcredits';
        break;
      case 'end_postcredits':
        this.currentPhase = 'ended';
        this.endDetected = true;
        if (this.navigationMonitor) {
          clearInterval(this.navigationMonitor);
          this.navigationMonitor = null;
        }
        break;
    }

    // Handle stop recording trigger - now works with ANY event
    if (this.options.stopRecordingAt === eventType) {
      this.log(`*** Stop trigger detected: ${eventType} event ***`);
      
      // Only add buffer for final episode completion events
      const finalEvents = ['end_postcredits', 'episode_end'];
      const delay = finalEvents.includes(eventType) ? 3000 : 100;
      
      if (delay > 100) {
        this.log('Adding 3-second buffer before stopping recording...');
      }
      
      this.endDetected = true;
      setTimeout(() => this.stopRecording(), delay);
    }

    // Special case: end_postcredits always ends the episode
    if (eventType === 'end_postcredits' && this.options.stopRecordingAt !== 'never') {
      this.log('*** Episode end detected: end_postcredits event ***');
      this.log('Adding 3-second buffer before stopping recording...');
      this.endDetected = true;
      setTimeout(() => this.stopRecording(), 3000);
    }
  }

    async exportProcessedData() {
    if (!this.options.exportData) {
      this.log('Data export disabled, skipping JSON export', 'debug');
      return;
    }

    try {
      this.log(`Starting data export. baseName: ${this.options.baseName}, outputDir: ${this.options.outputDir}`);
      const finalJsonPath = path.join(this.options.outputDir, `${this.options.baseName}_session-log.json`);
      this.log(`Target session log path: ${finalJsonPath}`);

      if (this.showConfig || this.episodeData || this.recorderEvents.length > 0) {
        this.log(`Exporting data: showConfig=${!!this.showConfig}, episodeData=${!!this.episodeData}, events=${this.recorderEvents.length}`);
        
        const sessionData = {
          episode_id: this.episodeData?.id || this.episodeInfo?.episodeId || this.options.episodeData?.episode_number || null,
          show_id: this.showConfig?.id || null,
          recording_session_options: this.options,
          show_config: this.showConfig || null, 
          episode_data: this.episodeData || null,
          fetcher_episode_data: this.options.episodeData || null,
          event_timeline: this.recorderEvents,
          original_video_file: this.outputFile?.path ? path.basename(this.outputFile.path) : null,
          processed_mp4_file: this.outputFile?.path ? path.basename(this.outputFile.path).replace(/(\.\w+)$/, `_fps${this.options.frameRate}.mp4`) : null
        };
        
        this.log(`Writing session data to: ${finalJsonPath}`);
        fs.writeFileSync(finalJsonPath, JSON.stringify(sessionData, null, 2));
        this.log(`✅ Session log exported to: ${finalJsonPath}`);
        
        // Also export just the episode data for WordPress submission
        if (sessionData.episode_data) {
          const episodeDataPath = finalJsonPath.replace('_session-log.json', '_episode-data.json');
          this.log(`Writing episode data to: ${episodeDataPath}`);
          fs.writeFileSync(episodeDataPath, JSON.stringify(sessionData.episode_data, null, 2));
          this.log(`✅ Episode data exported to: ${episodeDataPath}`);
        } else {
          this.log('No episode data to export separately', 'debug');
        }
      } else {
        this.log('No data to export for session log - showConfig, episodeData, and events are all empty', 'warn');
        this.log(`Debug: showConfig=${!!this.showConfig}, episodeData=${!!this.episodeData}, events=${this.recorderEvents.length}`, 'debug');
      }
    } catch (error) {
      this.log(`❌ Error exporting data: ${error.message}`, 'error');
      this.log(`Error stack: ${error.stack}`, 'error');
    }
  }

  async loadEpisodeUrl(url) {
    this.log(`Loading episode: ${url}`);

    try {
      this.startNavigationMonitoring(url);
      await this.page.setCacheEnabled(false);

      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.options.waitTimeout
      });

      this.episodeInfo = await this.page.evaluate(() => {
        return {
          name: document.title.split(' - ')[0] || 'episode',
          showTitle: window.shmotimeVoice?.showTitle || 'show',
          episodeId: window.shmotimeVoice?.shmotimeId || ''
        };
      });

      await this.page.evaluate(() => {
        const originalPushState = history.pushState;
        history.pushState = function() {
          originalPushState.apply(this, arguments);
          console.log(`Navigation detected to: ${arguments[2]}`);
        };

        window.addEventListener('beforeunload', function() {
          console.log('Page navigation or unload detected');
        });

        document.querySelectorAll('audio, video').forEach(el => {
          el.muted = false;
          el.volume = 1;
        });
      });

      this.log(`Loaded episode: ${this.episodeInfo.name}`);
      return this.episodeInfo;
    } catch (error) {
      this.log(`Error loading episode: ${error.message}`, 'error');
      return null;
    }
  }

  startNavigationMonitoring(originalUrl) {
    if (this.navigationMonitor) {
      clearInterval(this.navigationMonitor);
    }

    this.navigationMonitor = setInterval(async () => {
      try {
        if (!this.page || this.page.isClosed()) {
          this.log('Page is closed, stopping navigation monitor');
          clearInterval(this.navigationMonitor);
          this.navigationMonitor = null;
          this.endDetected = true;
          return;
        }

        const currentUrl = await this.page.url();
        if (currentUrl !== originalUrl && !currentUrl.includes('chrome-extension://')) {
          this.log(`Navigation detected from ${originalUrl} to ${currentUrl}`);
          this.endDetected = true;
        }

        // Enhanced episode completion detection
        const episodeStatus = await this.page.evaluate(() => {
          // Check for showrunner status
          const status = document.querySelector('.showrunner-status');
          const isCompleted = status && (
            status.textContent.includes('complete') ||
            status.textContent.includes('ended') ||
            status.textContent.includes('finished')
          );

          // Check if episode has looped back to start screen
          const hasSlateButton = document.querySelector('.slate-ready, .start-button, [data-action="start"]') !== null;
          const slateVisible = hasSlateButton && 
            window.getComputedStyle(document.querySelector('.slate-ready, .start-button, [data-action="start"]')).display !== 'none';

          // Check for any text indicating "start" or "begin"
          const allButtons = Array.from(document.querySelectorAll('button'));
          const hasStartText = allButtons.some(btn => 
            btn.textContent.toLowerCase().includes('start') || 
            btn.textContent.toLowerCase().includes('begin')
          );

          return {
            isCompleted,
            hasSlateButton,
            slateVisible,
            hasStartText,
            currentTime: Date.now()
          };
        }).catch(() => ({ isCompleted: false, hasSlateButton: false, slateVisible: false, hasStartText: false }));

        if (episodeStatus.isCompleted) {
          this.log('Episode completion detected through status element');
          this.endDetected = true;
        }

        // Detect if episode has looped back to start (after sufficient playback time)
        const playbackDuration = this.episodePlaybackStartTime ? Date.now() - this.episodePlaybackStartTime : 0;
        if (playbackDuration > 60000 && (episodeStatus.slateVisible || episodeStatus.hasStartText)) { // After 1 minute of playback
          this.log(`*** Episode loop detected: Start screen visible after ${Math.round(playbackDuration/1000)}s of playback ***`);
          this.log('This likely means the episode has ended and returned to the beginning');
          this.endDetected = true;
        }

      } catch (error) {
        // Ignore errors in the monitor
      }
    }, 2000);
  }

  getRecordingFilename(extension = 'webm') {
    return path.join(this.options.outputDir, `${this.options.baseName}.${extension}`);
  }

  log(message, level = 'info') {
    if (!this.options.verbose && level === 'debug') return;
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    switch (level) {
      case 'error':
        console.error(`[${timestamp}] ERROR: ${message}`);
        break;
      case 'warn':
        console.warn(`[${timestamp}] WARN: ${message}`);
        break;
      case 'debug':
        console.log(`[${timestamp}] DEBUG: ${message}`);
        break;
      default:
        console.log(`[${timestamp}] ${message}`);
    }
  }

  async initialize() {
    this.log('Initializing browser...');
    fs.mkdirSync(this.options.outputDir, { recursive: true });

    if (this.options.headless && this.options.outputFormat === 'mp4') {
      this.log('MP4 format is often not supported in headless mode, using WebM instead.', 'warn');
      this.options.outputFormat = 'webm';
    }

    const windowWidth = this.options.videoWidth;
    const windowHeight = this.options.videoHeight;

    const browserArgs = [
      '--no-sandbox',
      `--ozone-override-screen-size=${windowWidth},${windowHeight}`,      
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--disable-infobars',
      '--hide-crash-restore-bubble',
      '--disable-blink-features=AutomationControlled',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--enable-accelerated-video-decode',
      '--enable-accelerated-video',
      '--disable-features=AudioServiceOutOfProcess',
      '--force-video-overlays',
      '--enable-features=VaapiVideoDecoder',
      '--disable-features=VizDisplayCompositor',
      `--force-device-scale-factor=1`,
      // NOTE: Do NOT disable extensions - puppeteer-stream requires its extension!
      // '--disable-extensions',
      '--disable-plugins',
      // '--disable-extensions-file-access-check',  // May interfere with puppeteer-stream
      // '--disable-component-extensions-with-background-pages',  // May interfere with puppeteer-stream
      // '--user-data-dir=/tmp/chrome-recorder-' + Date.now(),  // Fresh profile may prevent extension loading
      '--no-default-browser-check',
      '--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli',  // puppeteer-stream extension ID
    ];
    
    // Add mute arguments if mute option is enabled
    if (this.options.muteAudio) {
      browserArgs.push(
        '--mute-audio',
        '--disable-audio-output',
        '--disable-audio'
      );
    }
    
    if (this.options.headless) {
      browserArgs.push(
        '--headless=new',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox'
      );
    }

    const executablePath = this.options.executablePath || this.getChromePath();
    if (!executablePath) {
      throw new Error('Could not find Chrome executable. Please specify using --chrome-path=');
    }

    this.log(`Using Chrome at: ${executablePath}`);

    this.browser = await launch({
      headless: this.options.headless ? "new" : false,
      args: browserArgs,
      executablePath: executablePath,
      defaultViewport: null
    });  

    this.page = await this.browser.newPage();

    // KEEP the original CDP session setup - this is important!
    const session = await this.page.target().createCDPSession();
    const {windowId} = await session.send('Browser.getWindowForTarget');
    
    const uiSize = await this.page.evaluate(() => {
      return {
        height: window.outerHeight - window.innerHeight,
        width: window.outerWidth - window.innerWidth,
      };
    });
    
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        height: windowHeight + uiSize.height,
        width: windowWidth + uiSize.width,
      },
    });
    
    await this.page.setViewport({
      width: windowWidth,
      height: windowHeight,
      deviceScaleFactor: 1
    });
    
    // KEEP the original CSS - it works!
    await this.page.addStyleTag({
      content: `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: ${windowWidth}px !important;
          height: ${windowHeight}px !important;
          overflow: hidden !important;
          background: black !important;
        }
        
        #root, main, .app-container, .scene-container, .player-container, 
        [class*="container"], [class*="wrapper"], [class*="player"], [class*="scene"] {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          z-index: 1 !important;
        }
        
        video {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          z-index: 999000 !important;
          background: black !important;
          object-fit: contain !important;
          transform: translate(0, 0) !important;
        }
        
        .header-container, header {
          z-index: 0 !important;
        }
      `
    });
    
    const screenDimensions = await this.page.evaluate(() => ({
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight
    }));
    
    this.log(`Screen dimensions: ${screenDimensions.screenWidth}x${screenDimensions.screenHeight}`);
    this.log(`Outer window: ${screenDimensions.outerWidth}x${screenDimensions.outerHeight}`);
    this.log(`Viewport dimensions: ${screenDimensions.innerWidth}x${screenDimensions.innerHeight}`);
    
    this.page.setDefaultNavigationTimeout(120000);
    this.setupErrorHandling();
    this.log('Browser initialized successfully');
    return this;
  }

  setupErrorHandling() {
    this.page.on('console', async msg => {
      const msgArgs = msg.args();
      if (msgArgs.length === 0) {
        if (this.options.verbose) this.log(`Browser (empty console args): ${msg.text()}`, 'debug');
        return;
      }

      let eventText = '';
      try {
        eventText = await msgArgs[0].jsonValue(); 
      } catch (e) {
        eventText = msg.text(); 
      }
      
      if (typeof eventText !== 'string') {
        if (this.options.verbose) this.log(`Browser (non-string eventText after processing arg[0]): ${msg.text()}`, 'debug');
        eventText = msg.text(); 
        if (typeof eventText !== 'string') {
             if (this.options.verbose) this.log(`Browser (eventText still not a string, cannot parse event): ${msg.text()}`, 'debug');
             return;
        }
      }

      // Enhanced debugging for recorder events
      if (eventText.includes('recorder:')) {
        this.log(`🎬 RECORDER EVENT DETECTED: "${eventText}" (args: ${msgArgs.length})`);
        if (msgArgs.length > 1) {
          try {
            const secondArg = await msgArgs[1].jsonValue();
            this.log(`🎬 Event data: ${JSON.stringify(secondArg, null, 2)}`);
          } catch (e) {
            this.log(`🎬 Could not parse second argument: ${e.message}`);
          }
        }
      }

      // Extra debugging for lifecycle events that might be missed
      if (eventText.includes('start_') || eventText.includes('end_') || 
          eventText.includes('intro') || eventText.includes('credits') || 
          eventText.includes('postcredits')) {
        this.log(`🎭 LIFECYCLE EVENT CANDIDATE: "${eventText}" (args: ${msgArgs.length})`);
      }

      if (eventText.startsWith('recorder:')) {
        try {
          const eventTypeMatch = eventText.match(/^recorder:(\w+)/);
          if (eventTypeMatch) {
            const eventType = eventTypeMatch[1];
            let eventData = null;

            if (msgArgs.length > 1) {
              try {
                eventData = await msgArgs[1].jsonValue();
              } catch (jsonError) {
                this.log(`Failed to get JSON value for recorder event data (${eventType}): ${jsonError.message}`, 'warn');
                try {
                    const rawDataText = await msgArgs[1].evaluate(arg => {
                        if (arg instanceof Error) return arg.message;
                        if (arg instanceof Object) return JSON.stringify(arg);
                        return String(arg);
                    });
                    this.log(`Raw event data for ${eventType} (fallback): ${rawDataText}`, 'debug');
                    if (typeof rawDataText === 'string' && (rawDataText.startsWith('{') || rawDataText.startsWith('['))) {
                        try { eventData = JSON.parse(rawDataText); } catch (e) { /* ignore parse error */ }
                    }
                } catch (rawDataError) {
                    this.log(`Could not get raw string/JSON for event data ${eventType}: ${rawDataError.message}`, 'debug');
                }
              }
            }
            this.handleRecorderEvent(eventType, eventData);
            return; 
          }
        } catch (error) {
          this.log(`Error processing recorder event (${eventText}): ${error.message}`, 'error');
        }
      }

      // Fallback to legacy navigation detection and regular console message handling
      if (eventText.includes('Navigating to next episode:')) {
        this.log('*** Episode end detected: "Navigating to next episode" message found ***');
        this.endDetected = true;
        if (this.navigationMonitor) {
          clearInterval(this.navigationMonitor);
          this.navigationMonitor = null;
        }
      }

      if (msg.type() === 'error') {
        this.log(`Browser: ${eventText}`, 'error');
      } else if (msg.type() === 'warning') {
        this.log(`Browser: ${eventText}`, 'warn');
      } else if (this.options.verbose) {
        this.log(`Browser: ${eventText}`, 'debug');
      } else if (
        eventText.includes('scene:') ||
        eventText.includes('showrunner:') ||
        eventText.includes('Stage3D:') ||
        eventText.includes('dialogue:') ||
        eventText.includes('playback') ||
        eventText.includes('start_') ||
        eventText.includes('end_') ||
        eventText.includes('recorder:') ||
        eventText.includes('intro') ||
        eventText.includes('credits') ||
        eventText.includes('postcredits') ||
        eventText.includes('ep')
      ) {
        this.log(`Browser: ${eventText}`);
      }
    });

    this.page.on('requestfailed', request => {
      const url = request.url();
      if (url.includes('.mp3') || url.includes('.mp4') || url.includes('media') || url.includes('audio')) {
        this.log(`Failed to load media: ${url} - ${request.failure().errorText}`, 'error');
      }
    });

    this.page.on('error', err => {
      this.log(`Page error: ${err.message}`, 'error');
    });

    this.page.on('close', () => {
      this.log('Page was closed');
      this.endDetected = true;
    });
  }

  async startEpisode() {
    this.log('Starting episode playback...');

    try {
      // Get the correct frame context (main page or iframe)
      const playFrame = await this.getPlayableFrame();
      const isIframe = playFrame !== this.page.mainFrame();

      if (isIframe) {
        this.log(`Detected iframe player: ${playFrame.url()}`);
      }

      this.log('Waiting for start button...');
      await playFrame.waitForFunction((selector) => {
        const slate = document.querySelector(selector);
        return slate && window.getComputedStyle(slate).display !== 'none';
      }, { timeout: this.options.waitTimeout }, this.SLATE_WAIT_SELECTOR);

      let videoFile = null;

      if (this.options.record) {
        const viewportSize = await this.page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
          bodyWidth: document.body.clientWidth,
          bodyHeight: document.body.clientHeight
        }));
        
        this.log(`Pre-recording dimensions check:
          Viewport: ${viewportSize.width}x${viewportSize.height}
          Body: ${viewportSize.bodyWidth}x${viewportSize.bodyHeight}`);
        
        if (viewportSize.height !== this.options.videoHeight || 
            viewportSize.width !== this.options.videoWidth) {
          this.log('Viewport dimensions mismatch - attempting to fix...', 'warn');
          
          await this.page.setViewport({
            width: this.options.videoWidth,
            height: this.options.videoHeight,
            deviceScaleFactor: 1
          });
          
          await this.page.addStyleTag({
            content: `
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                width: ${this.options.videoWidth}px !important;
                height: ${this.options.videoHeight}px !important;
                overflow: hidden !important;
              }
              
              #root, .app-container, main, .scene-container, .player-container {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                overflow: hidden !important;
              }
            `
          });
        }
          
        const filename = this.getRecordingFilename(this.options.outputFormat);
        this.log(`Starting recording: ${filename}`);
        this.outputFile = fs.createWriteStream(filename);

        const mimeType = this.options.outputFormat === 'mp4' ?
          "video/mp4;codecs=avc1,mp4a.40.2" :
          "video/webm;codecs=vp8,opus";

        this.log(`Using codec: ${mimeType}`, 'debug');

        try {
          this.stream = await getStream(this.page, {
            audio: true,
            video: true,
            frameSize: 1000,
            bitsPerSecond: 8000000,
            mimeType: mimeType
          });
          
          videoFile = filename;
        } catch (error) {
          const errMsg = error?.message || String(error) || 'Unknown error';
          if (this.options.outputFormat === 'mp4' && errMsg.includes('not supported')) {
            this.log('MP4 recording failed, falling back to WebM format.', 'warn');
            this.options.outputFormat = 'webm';

            if (this.outputFile) {
              this.outputFile.close();
            }

            const webmFilename = this.getRecordingFilename('webm');
            this.log(`Switching to WebM recording: ${webmFilename}`);
            this.outputFile = fs.createWriteStream(webmFilename);

            this.stream = await getStream(this.page, {
              audio: true,
              video: true,
              frameSize: 1000,
              bitsPerSecond: 6000000,
              mimeType: "video/webm;codecs=vp8,opus"
            });

            videoFile = webmFilename;
          } else {
            this.log(`Recording error: ${errMsg}`, 'error');
            if (error?.stack) this.log(`Stack: ${error.stack}`, 'debug');
            throw new Error(errMsg);
          }
        }  
   
        this.stream.pipe(this.outputFile);
        
        this.log(`Recording started with dimensions ${this.options.videoWidth}x${this.options.videoHeight} @ ${this.options.frameRate}fps`);
        this.log(`Stream settings: frameSize=1000ms, codec=${mimeType}`, 'debug');
        this.log(`FFmpeg will set final frame rate to ${this.options.frameRate}fps during post-processing.`, 'debug');
      }

      this.log('Clicking start button...');
      try {
        // Use the correct frame context (playFrame) for clicking
        const clickResult = await playFrame.evaluate(({ slateButtonSelectors, textButtonSelectorsLC, slateContainerSelectors }) => {
          let clicked = false;
          let clickTargetInfo = 'No suitable click targets found';

          // Try specific selectors first
          for (const selector of slateButtonSelectors) {
            const btn = document.querySelector(selector);
            if (btn) {
              try {
                btn.click();
                clicked = true;
                clickTargetInfo = `Clicked button: ${btn.outerHTML.substring(0, 80)}...`;
                break;
              } catch (e) { /* continue */ }
            }
          }

          // Try text-based button search
          if (!clicked) {
            const allButtons = Array.from(document.querySelectorAll('button'));
            for (const btn of allButtons) {
              const btnText = btn.textContent.toLowerCase();
              if (textButtonSelectorsLC.some(txt => btnText.includes(txt))) {
                try {
                  btn.click();
                  clicked = true;
                  clickTargetInfo = `Clicked button (text match): ${btn.outerHTML.substring(0, 80)}...`;
                  break;
                } catch (e) { /* continue */ }
              }
            }
          }

          // Try clicking on common slate areas if no buttons found or clicks failed
          if (!clicked) {
            for (const selector of slateContainerSelectors) {
              const el = document.querySelector(selector);
              if (el) {
                try {
                  el.click();
                  clicked = true;
                  clickTargetInfo = `Clicked slate element: ${el.outerHTML.substring(0, 80)}...`;
                  break;
                } catch (e) { /* continue */ }
              }
            }
          }
          return clickTargetInfo;
        }, { slateButtonSelectors: this.SLATE_BUTTON_SELECTORS, textButtonSelectorsLC: this.TEXT_BUTTON_SELECTORS_LOWERCASE, slateContainerSelectors: this.SLATE_CONTAINER_SELECTORS });

        this.log(`Click result: ${clickResult}`);
      } catch (error) {
        this.log(`Direct click evaluation failed: ${error.message}`, 'warn');
        // Fallback click using Puppeteer's direct click on combined selectors if evaluate fails
        try {
          if (isIframe) {
            const playOverlay = await playFrame.$('#play-overlay, #play-button, .play-content-wrapper');
            if (playOverlay) {
              await playOverlay.click();
              this.log('Fallback click succeeded on iframe element');
            } else {
              throw new Error('No clickable element found in iframe');
            }
          } else {
            await this.page.click(this.SLATE_BUTTON_SELECTORS.join(', '));
            this.log('Fallback click succeeded on primary selectors');
          }
        } catch (clickError) {
          this.log(`All click attempts failed - episode may not start properly: ${clickError.message}`, 'error');
        }
      }

      this.log('Waiting for scene to load...');
      try {
        // Use the correct frame context for scene detection
        await playFrame.waitForFunction((selectors) => {
          return (
            document.querySelector(selectors.slate)?.style.display === 'none' ||
            selectors.dialogue.some(sel => document.querySelector(sel)?.textContent !== '')
          );
        }, { timeout: this.options.waitTimeout }, { slate: this.SLATE_WAIT_SELECTOR, dialogue: this.DIALOGUE_TEXT_SELECTORS });
        this.log('Scene loaded successfully');
      } catch (error) {
        this.log('Could not detect scene load, continuing anyway...', 'warn');
      }

      await this.ensureAudioEnabled();
      this.log('Episode playback started');
      return { videoFile };
    } catch (error) {
      this.log(`Error starting episode: ${error.message}`, 'error');
      return { videoFile: null };
    }
  }

  async ensureAudioEnabled() {
    await this.page.evaluate((mute) => {
      function enableAudio() {
        document.querySelectorAll('audio, video').forEach(el => {
          if (el.paused) {
            el.play().catch(() => {});
          }
          el.muted = mute;
          el.volume = mute ? 0 : 1;
        });

        const speakerAudio = document.getElementById('speaker-audio');
        if (speakerAudio) {
          if (speakerAudio.paused) {
            speakerAudio.play().catch(() => {});
          }
          speakerAudio.muted = mute;
          speakerAudio.volume = mute ? 0 : 1;
        }

        try {
          document.querySelectorAll('iframe').forEach(iframe => {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
              iframeDoc.querySelectorAll('audio, video').forEach(el => {
                if (el.paused) {
                  el.play().catch(() => {});
                }
                el.muted = mute;
                el.volume = mute ? 0 : 1;
              });
            } catch (e) {
              // Cross-origin access might be blocked
            }
          });
        } catch (e) {}
      }

      enableAudio();
      setTimeout(enableAudio, 1000);
      setTimeout(enableAudio, 3000);
    }, this.options.muteAudio || false);
  }

  async waitForEpisodeToFinish(timeout = 120000) { // Reduced to 2 minutes for testing
    this.log(`Waiting for episode to finish using recorder events (timeout: ${timeout}ms)...`);

    const startTime = Date.now();
    let statusInterval;

    try {
      this.endDetected = false;
      
      statusInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        this.log(`Still waiting... (${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed) - Current phase: ${this.currentPhase}`);
        
        const recentEvents = this.recorderEvents.slice(-3).map(e => e.type).join(', ');
        if (recentEvents) {
          this.log(`Recent events: ${recentEvents}`, 'debug');
        }

        // Auto-complete if we have episode data but no progress events after 90 seconds
        if (elapsed > 90 && this.recorderEvents.length <= 2 && this.recorderEvents.some(e => e.type === 'load_episode')) {
          this.log('Auto-completing: Episode data loaded but no playback events detected after 90 seconds');
          this.endDetected = true;
        }
      }, 30000);

      while (!this.endDetected && (Date.now() - startTime) < timeout) {
        if (this.currentPhase === 'ended') {
          this.log('Episode ended detected through phase tracking');
          this.endDetected = true;
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
      }

      if (!this.endDetected) {
        this.log('Episode wait timeout reached - completing anyway', 'warn');
        this.endDetected = true; // Force completion on timeout
      }

      await new Promise(r => setTimeout(r, 2000));
      return this.endDetected;
    } catch (error) {
      this.log(`Error waiting for episode to finish: ${error.message}`, 'error');
      if (statusInterval) {
        clearInterval(statusInterval);
      }
      return false;
    } finally {
      if (this.navigationMonitor) {
        clearInterval(this.navigationMonitor);
        this.navigationMonitor = null;
      }
    }
  }

  async waitForEpisodeData(timeout = 30000) {
    this.log(`Waiting for episode data... (timeout: ${timeout}ms)`);
    const startTime = Date.now();
    while (!this.episodeData && (Date.now() - startTime) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (this.episodeData) {
      this.log('Episode data received.');
      return true;
    }
    this.log('Timed out waiting for episode data.', 'warn');
    return false;
  }

  async close() {
    this.log('Cleaning up resources...');

    // Ensure recording is stopped and ffmpeg starts
    if (this.stream && !this.recordingStopped) {
      await this.stopRecording();
    }

    // Wait for ffmpeg to finish if it was started
    if (this.ffmpegPromise) {
      this.log('Waiting for FFmpeg post-processing to complete...');
      try {
        await this.ffmpegPromise;
        this.log('FFmpeg processing finished.');
      } catch (err) {
        this.log(`FFmpeg error: ${err.message}`, 'error');
      }
    }

    await this.exportProcessedData();

    if (this.navigationMonitor) {
      clearInterval(this.navigationMonitor);
      this.navigationMonitor = null;
    }

    if (this.stream && !this.recordingStopped) {
      await this.stopRecording();
    }

    if (this.browser && !this.browser.process()?.killed) {
      try {
        await this.browser.close();
        this.log('Browser closed');
      } catch (error) {
        this.log(`Error closing browser: ${error.message}`, 'error');
      }
    }

    try {
      if (wss) (await wss).close();
      this.log('WebSocket server closed');
    } catch (error) {
      this.log(`Error closing WebSocket server: ${error.message}`, 'error');
    }

    this.log(`Session complete: ${this.recorderEvents.length} events recorded`);
    if (this.showConfig) {
      this.log(`Show: ${this.showConfig.id} (${Object.keys(this.showConfig.actors).length} actors)`);
    }
    if (this.episodeData) {
      this.log(`Episode: ${this.episodeData.id} (${this.episodeData.scenes.length} scenes)`);
    }

    this.log('All resources cleaned up');
  } 
}

function loadListTxtMapping(listPath) {
  if (!listPath) return {};
  // Loads list.txt (or other list file) and returns a map: slug -> date
  const mapping = {};
  try {
    const lines = fs.readFileSync(listPath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim() || !line.includes(',')) continue;
      const [date, url] = line.split(',', 2);
      let slug = url.trim().split('/').filter(Boolean).pop();
      mapping[slug] = date.trim();
    }
  } catch (e) {
    // If list file missing, just return empty mapping
  }
  return mapping;
}

// --- Robust slug extraction helper ---
function getEpisodeSlug(urlString) {
  const fallback = '';
  try {
    const { pathname } = new URL(urlString);
    const parts = pathname.split('/').filter(Boolean);
    const i = parts.indexOf('shmotime_episode');
    if (i >= 0 && i + 1 < parts.length) return parts[i + 1];
    return parts.at(-1) ?? fallback;
  } catch {
    return fallback;
  }
}

function slugToTitleCase(slug) {
  return slug
    .replace(/[^a-zA-Z0-9\- ]/g, ' ')
    .replace(/-/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => w[0] ? w[0].toUpperCase() + w.slice(1) : '')
    .join('-');
}

function getSlugFromUrl(url) {
  // Extracts the slug from a shmotime_episode URL robustly
  if (!url) return null;
  try {
    const parts = url.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p === 'shmotime_episode');
    if (idx >= 0 && idx + 1 < parts.length) {
      return parts[idx + 1];
    }
    // Fallback: use last non-empty segment
    return parts[parts.length - 1];
  } catch (e) {
    return null;
  }
}

// --- Canonical filename helper ---
function getCanonicalBaseName(episodeData, options, url) {
  // 1. Use --date if provided
  let date = options?.dateOverride || '';
  let title = '';
  // Always prefer slug from URL for title if URL is present
  let slug = null;
  if (url) {
    slug = getSlugFromUrl(url);
    if (slug) {
      title = slugifyTitle(slug.replace(/-/g, ' '));
    }
  }
  // Fallback to episodeData name if slug is empty
  if (!title) {
    if (episodeData?.name) {
      title = slugifyTitle(episodeData.name);
    } else if (options?.episodeData?.name) {
      title = slugifyTitle(options.episodeData.name);
    } else {
      title = 'Episode';
    }
  }
  // 2. If no --date, try list file (if specified)
  if (!date) {
    const listMapping = loadListTxtMapping(options?.listPath);
    if (!slug && url) {
      slug = getSlugFromUrl(url);
    }
    if (slug && listMapping[slug]) {
      date = listMapping[slug];
    }
  }
  // 3. If still no date, use today
  if (!date) {
    const now = new Date();
    date = now.toISOString().slice(0, 10);
  }
  return `${date}_Clank-Tank_${title}`;
}

// Command line interface - simplified but keeping all functionality
function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length === 0) {
    console.log(`
Usage: node recorder.js [options] <url>

Options:
  --headless                    Run in headless mode
  --no-record                   Disable video recording
  --no-export                   Disable data export
  --no-fix-framerate            Disable ffmpeg frame rate post-processing
  --mute                        Mute audio during recording
  --quiet                       Reduce log output
  --wait=<ms>                   Maximum wait time (default: 3600000)
  --output=<dir>                Output directory (default: ./episodes)
  --chrome-path=<path>          Chrome executable path
  --format=<format>             Video format: webm or mp4 (default: webm, headless forces webm)
  --stop-recording-at=<event>   When to stop recording (default: end_postcredits)
                                Options: start_intro, end_intro, start_ep, end_ep,
                                         start_credits, end_credits, start_postcredits,
                                         end_postcredits, never
  --height=<pixels>             Video height (default: 1080)
  --width=<pixels>              Video width (default: 1920)
  --fps=<number>                Frame rate (default: 30)
  --episode-data=<json>         Episode metadata JSON for S1E# filename generation
  --filename-suffix=<text>      Add suffix to filename (e.g. --filename-suffix=test → S1E12_Clank-Tank_title_test.webm)
  --date=<YYYY-MM-DD>           Override date for output filenames (recommended)
  --list=<path>                 Path to list file for date mapping (default: ../list.txt)
  --help                        Show this help

Examples:
  # Basic recording (stops at end_credits by default)
  node recorder.js https://shmotime.com/shmotime_episode/episode-url/
  
  # Specify canonical date for output filenames
  node recorder.js --date=2025-07-12 https://shmotime.com/shmotime_episode/the-suspended-account/
`);
    process.exit(0);
  }

  const headless = args.includes('--headless');
  const noRecord = args.includes('--no-record');
  const noExport = args.includes('--no-export');
  const noFixFrameRate = args.includes('--no-fix-framerate');
  const muteAudio = args.includes('--mute');
  const verbose = !args.includes('--quiet');
  const url = args.find(arg => !arg.startsWith('--')) || 'https://shmotime.com/shmotime_episode/the-security-sentinel/';
  const waitTime = parseInt(args.find(arg => arg.startsWith('--wait='))?.split('=')[1] || '3600000', 10);
  const outputDir = args.find(arg => arg.startsWith('--output='))?.split('=')[1] || './episodes';
  const chromePath = args.find(arg => arg.startsWith('--chrome-path='))?.split('=')[1] || '';
  const outputFormat = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'webm';
  const stopRecordingAt = args.find(arg => arg.startsWith('--stop-recording-at='))?.split('=')[1] || 'end_postcredits';
  const viewportHeight = parseInt(args.find(arg => arg.startsWith('--height='))?.split('=')[1] || '1080', 10);
  const viewportWidth = parseInt(args.find(arg => arg.startsWith('--width='))?.split('=')[1] || '1920', 10);
  const frameRate = parseInt(args.find(arg => arg.startsWith('--fps='))?.split('=')[1] || '30', 10);
  const filenameSuffix = args.find(arg => arg.startsWith('--filename-suffix='))?.split('=')[1] || '';
  const dateOverride = args.find(arg => arg.startsWith('--date='))?.split('=')[1] || '';
  const listPath = args.find(arg => arg.startsWith('--list='))?.split('=')[1];
  
  // Parse episode data JSON
  const episodeDataRaw = args.find(arg => arg.startsWith('--episode-data='))?.split('=')[1];
  let episodeData = null;
  if (episodeDataRaw) {
    try {
      episodeData = JSON.parse(episodeDataRaw);
      console.log(`📺 Using episode data: ${episodeData.episode_number} - ${episodeData.name}`);
    } catch (error) {
      console.error(`❌ Invalid episode data JSON: ${error.message}`);
      process.exit(1);
    }
  }

  // --- Canonical baseName logic ---
  const slug = getEpisodeSlug(url);
  if (!slug) {
    console.error('❌  Could not extract episode slug from URL. Refusing to start—pass --date and/or --episode-data manually.');
    process.exit(1);
  }
  // Date logic
  let canonicalDate = dateOverride;
  if (!canonicalDate) {
    const listPath = args.find(arg => arg.startsWith('--list='))?.split('=')[1];
    const listMapping = loadListTxtMapping(listPath);
    if (listMapping[slug]) {
      canonicalDate = listMapping[slug];
    }
  }
  if (!canonicalDate) {
    canonicalDate = new Date().toISOString().slice(0, 10);
  }
  const baseName = `${canonicalDate}_Clank-Tank_${slugToTitleCase(slug)}`;
  if (/Episode/i.test(baseName)) {
    throw new Error(`Filename fallback detected (${baseName}). Aborting.`);
  }

  const validStopEvents = [
    'start_intro', 'end_intro',
    'start_ep', 'end_ep', 
    'start_credits', 'end_credits',
    'start_postcredits', 'end_postcredits',
    'never' // For manual control
  ];
  if (!validStopEvents.includes(stopRecordingAt)) {
    console.error(`Invalid --stop-recording-at value: ${stopRecordingAt}`);
    console.error(`Valid options: ${validStopEvents.join(', ')}`);
    process.exit(1);
  }

  return {
    url,
    options: {
      headless,
      record: !noRecord,
      exportData: !noExport,
      fixFrameRate: !noFixFrameRate,
      muteAudio,
      verbose,
      outputDir,
      waitTimeout: 60000,
      executablePath: chromePath,
      outputFormat,
      stopRecordingAt,
      videoWidth: viewportWidth,
      videoHeight: viewportHeight,
      frameRate,
      episodeData,
      filenameSuffix,
      dateOverride,
      listPath,
      baseName // <--- add to options
    },
    waitTime
  };
}

async function main() {
  const { url, options, waitTime } = parseArgs();
  
  console.log('Shmotime Player V2 starting...');
  console.log(`URL: ${url}`);
  console.log(`Settings: headless=${options.headless}, record=${options.record}, export=${options.exportData}, format=${options.outputFormat}, verbose=${options.verbose}`);
  console.log(`Recording: stop at ${options.stopRecordingAt}`);
  console.log(`Video: ${options.videoWidth}x${options.videoHeight}@${options.frameRate}fps`);
  
  if (options.episodeData) {
    console.log(`🎬 Episode: ${options.episodeData.episode_number} - ${options.episodeData.name}`);
    console.log(`📁 Expected filename: ${options.episodeData.episode_number}_JedAI-Council-${options.episodeData.clean_title}.${options.outputFormat}`);
  }

  const player = new ShmotimeRecorder(options);

  try {
    await player.initialize();

    const episodeInfo = await player.loadEpisodeUrl(url);
    if (!episodeInfo) {
      throw new Error('Failed to load episode');
    }

    const { videoFile } = await player.startEpisode();

    if (options.record) {
      if (!videoFile) {
        throw new Error('Failed to start episode recording');
      }
      await player.waitForEpisodeToFinish(waitTime);
      console.log('Episode processing complete');
      if (videoFile) console.log(`Video will be saved to: ${videoFile}`);
    } else {
      await player.waitForEpisodeData();
      console.log('Episode data retrieval complete.');
    }

  } catch (error) {
    console.error(`Main process error: ${error.message}`);
  } finally {
    await player.close();
    console.log('Process complete');
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = ShmotimeRecorder;
