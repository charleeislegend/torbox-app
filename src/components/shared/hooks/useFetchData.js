import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { isQueuedItem, getAutoStartOptions, sortItems } from '@/utils/utility';
import { retryFetch } from '@/utils/retryFetch';
import { validateUserData } from '@/utils/monitoring';
import { perfMonitor } from '@/utils/performance';

// Rate limit constants
const MAX_CALLS = 5;
const WINDOW_SIZE = 10000; // 10 seconds in ms
const MIN_INTERVAL_BETWEEN_CALLS = 2000; // Minimum 2 seconds between calls
const MIN_INTERVAL_MAPPING = { torrents: 2000, usenet: 2000, webdl: 2000 };
const ACTIVE_POLLING_INTERVAL = 10000; // 10 seconds in ms
const INACTIVE_POLLING_INTERVAL = 60000; // 1 minute in ms
const AUTO_START_CHECK_INTERVAL = 30000; // 30 seconds in ms
const AUTOMATION_POLLING_INTERVAL = 300000; // 5 minutes in ms

// Polling Logic
// 1. ✅ 10s polling when browser is focused
// 2. ✅ 1m polling when browser is not focused AND auto-start is enabled AND there are queued torrents
// 3. ✅ No polling when browser is not focused AND (auto-start is disabled OR no queued torrents)

export function useFetchData(apiKey, type = 'torrents') {
  // Separate state for each data type - ensure they're always arrays
  const [torrents, setTorrents] = useState([]);
  const [usenetItems, setUsenetItems] = useState([]);
  const [webdlItems, setWebdlItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const torrentsRef = useRef([]);
  const usenetRef = useRef([]);
  const webdlRef = useRef([]);
  const lastAutoStartCheckRef = useRef(0);
  const processedQueueIdsRef = useRef(new Set());
  const [hasActiveRules, setHasActiveRules] = useState(false);

  // A per-type rate limit tracker
  const rateLimitDataRef = useRef({});

  // Update refs whenever state changes
  useEffect(() => {
    torrentsRef.current = torrents;
  }, [torrents]);

  useEffect(() => {
    usenetRef.current = usenetItems;
  }, [usenetItems]);

  useEffect(() => {
    webdlRef.current = webdlItems;
  }, [webdlItems]);

  // Fetch all data types on initial mount and when API key changes
  useEffect(() => {
    const fetchAllTypes = async () => {
      if (!apiKey) return;

      await Promise.all([
        fetchLocalItems(true, 'torrents'),
        fetchLocalItems(true, 'usenet'),
        fetchLocalItems(true, 'webdl'),
      ]);
    };

    fetchAllTypes();
  }, [apiKey]);

  const isRateLimited = useCallback(
    (activeType = type) => {
      // Ensure rate limit data exists for the current type
      if (!rateLimitDataRef.current[activeType]) {
        rateLimitDataRef.current[activeType] = {
          callTimestamps: [],
          lastFetchTime: 0,
          latestFetchId: 0,
        };
      }
      const rateData = rateLimitDataRef.current[activeType];
      const now = Date.now();
      const minInterval =
        MIN_INTERVAL_MAPPING[activeType] || MIN_INTERVAL_BETWEEN_CALLS;
      if (now - rateData.lastFetchTime < minInterval) {
        return true;
      }
      // Filter outdated timestamps and take last MAX_CALLS
      rateData.callTimestamps = rateData.callTimestamps
        .filter((timestamp) => now - timestamp < WINDOW_SIZE)
        .slice(-MAX_CALLS);
      return rateData.callTimestamps.length >= MAX_CALLS;
    },
    [type],
  );

  const checkAndAutoStartTorrents = useCallback(
    async (items) => {
      // Only apply auto-start to torrents
      if (type !== 'torrents') return;

      try {
        const options = getAutoStartOptions();
        if (!options?.autoStart) return;

        const activeCount = items.filter((item) => item.active).length;
        const queuedItems = items.filter(isQueuedItem);

        // If we have room for more active items and there are queued ones
        if (activeCount < options.autoStartLimit && queuedItems.length > 0) {
          const queuedId = queuedItems[0].id;

          // Skip if we've already tried to start this item
          if (processedQueueIdsRef.current.has(queuedId)) return;

          // Add to processed set before making API call
          processedQueueIdsRef.current.add(queuedId);

          // Force start the first queued item
          await retryFetch('/api/torrents/controlqueued', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify({
              queued_id: queuedId,
              operation: 'start',
              type: 'torrent',
            }),
          });
        }
      } catch (error) {
        console.error('Error in auto-start check:', error);
      }
    },
    [apiKey, type],
  );

  const fetchLocalItems = useCallback(
    async (bypassCache = false, customType = null, retryCount = 0) => {
      const activeType = customType || type;
      setLoading(true);
      
      // Prevent infinite retry loops
      if (retryCount > 1) {
        console.error('Max retry attempts reached, giving up');
        setLoading(false);
        return [];
      }

      if (!apiKey) {
        setLoading(false);
        return [];
      }

      // Ensure rate limit data exists for the active type
      if (!rateLimitDataRef.current[activeType]) {
        rateLimitDataRef.current[activeType] = {
          callTimestamps: [],
          lastFetchTime: 0,
          latestFetchId: 0,
        };
      }
      const rateData = rateLimitDataRef.current[activeType];

      if (isRateLimited(activeType)) {
        console.warn(`Rate limit reached for ${activeType}, skipping fetch`);
        return [];
      }

      // Update rate limiting data
      const now = Date.now();
      rateData.lastFetchTime = now;
      rateData.callTimestamps.push(now);
      const currentFetchId = ++rateData.latestFetchId;

      // If this call isn't the latest, do not update state
      if (currentFetchId !== rateData.latestFetchId) {
        return [];
      }

      // Determine endpoint based on activeType
      let endpoint;
      switch (activeType) {
        case 'usenet':
          endpoint = '/api/usenet';
          break;
        case 'webdl':
          endpoint = '/api/webdl';
          break;
        default:
          endpoint = '/api/torrents';
      }

      try {
        perfMonitor.startTimer(`fetch-${activeType}`);
        const response = await fetch(endpoint, {
          headers: {
            'x-api-key': apiKey,
            ...(bypassCache && { 'bypass-cache': 'true' }),
            'Cache-Control': 'no-cache', // Force fresh data to prevent cross-user contamination
          },
        });

        if (!response.ok) {
          throw new Error(
            `Error fetching ${activeType} data: ${response.status}`,
          );
        }

        const data = await response.json();
        perfMonitor.endTimer(`fetch-${activeType}`);

        if (
          data.success &&
          data.data &&
          Array.isArray(data.data)
        ) {
          // Validate user data to prevent cross-user contamination
          if (!validateUserData(data.data, apiKey)) {
            console.warn(`Invalid user data detected (attempt ${retryCount + 1}/2), retrying with cache bypass`);
            // Add a small delay before retry to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 1000));
            return fetchLocalItems(true, customType, retryCount + 1);
          }

          // Sort items by added date if available
          const sortedItems = sortItems(data.data);

          // Update the appropriate state based on the type
          switch (activeType) {
            case 'usenet':
              setUsenetItems(sortedItems.map(item => ({ ...item, assetType: 'usenet' })));
              break;
            case 'webdl':
              setWebdlItems(sortedItems.map(item => ({ ...item, assetType: 'webdl' })));
              break;
            default:
              setTorrents(sortedItems.map(item => ({ ...item, assetType: 'torrents' })));
              // Only check auto-start for torrents if 30 seconds have elapsed
              if (
                now - lastAutoStartCheckRef.current >=
                AUTO_START_CHECK_INTERVAL
              ) {
                await checkAndAutoStartTorrents(sortedItems);
                lastAutoStartCheckRef.current = now;
              }
          }

          if (activeType === type) {
            setError(null);
          }

          setLoading(false);

          // Return the fetched data
          return sortedItems;
        } else {
          if (data.success && data.data && Array.isArray(data.data) && data.data.length === 0) {
            // Empty data is valid, just return empty array
            setLoading(false);
            return [];
          } else {
            console.error(`Invalid ${activeType} data format:`, data);
            setLoading(false);
            return [];
          }
        }
      } catch (err) {
        console.error(`Error fetching ${activeType} data:`, err);
        // Only set error state if this is the latest fetch and current type
        if (currentFetchId === rateData.latestFetchId && activeType === type) {
          // Provide more user-friendly error messages
          let userMessage = `Failed to fetch ${activeType} data`;
          
          if (err.message.includes('502')) {
            userMessage = `TorBox servers are temporarily unavailable. ${activeType} data may not be up to date.`;
          } else if (err.message.includes('503')) {
            userMessage = `TorBox servers are temporarily overloaded. ${activeType} data may not be up to date.`;
          } else if (err.message.includes('504')) {
            userMessage = `TorBox servers are taking too long to respond. ${activeType} data may not be up to date.`;
          } else if (err.message.includes('NetworkError') || err.message.includes('Failed to fetch')) {
            userMessage = `Unable to connect to TorBox servers. ${activeType} data may not be up to date.`;
          } else if (err.message.includes('401')) {
            userMessage = 'Authentication failed. Please check your API key.';
          } else if (err.message.includes('403')) {
            userMessage = 'Access denied. Please check your API key and account status.';
          } else if (err.message.includes('429')) {
            userMessage = 'Too many requests to TorBox servers. Please wait a moment.';
          }
          
          setError(userMessage);
        }
        setLoading(false);
        // Return empty array to prevent undefined state
        return [];
      }
    },
    [apiKey, checkAndAutoStartTorrents, isRateLimited, type],
  );

  // Fetch data on type change
  useEffect(() => {
    const initialFetch = async () => {
      // Only fetch the current active type when type changes
      await fetchLocalItems(true, type);
    };

    initialFetch();
  }, [type, fetchLocalItems]);

  // Active data based on the current type
  const items = useMemo(() => {
    switch (type) {
      case 'all':
        // Combine all types (assetType is already present on each item)
        const allItems = [
          ...(torrents || []),
          ...(usenetItems || []),
          ...(webdlItems || [])
        ];
        return allItems;
      case 'usenet':
        return usenetItems || [];
      case 'webdl':
        return webdlItems || [];
      default:
        return torrents || [];
    }
  }, [type, torrents, usenetItems, webdlItems]);

  // Setter and fetch functions based on the current type
  const setItems = useMemo(() => {
    switch (type) {
      case 'all':
        // For 'all' type, we need to update the appropriate individual state
        // This is a bit complex since we need to determine which type each item belongs to
        return (newItems) => {
          // Safety check: ensure newItems is an array
          if (!Array.isArray(newItems)) {
            console.warn('setItems called with non-array:', newItems);
            return;
          }
          
          const torrentItems = newItems.filter(item => item.assetType === 'torrents');
          const usenetItems = newItems.filter(item => item.assetType === 'usenet');
          const webdlItems = newItems.filter(item => item.assetType === 'webdl');
          
          setTorrents(torrentItems);
          setUsenetItems(usenetItems);
          setWebdlItems(webdlItems);
        };
      case 'usenet':
        return setUsenetItems;
      case 'webdl':
        return setWebdlItems;
      default:
        return setTorrents;
    }
  }, [type, setUsenetItems, setWebdlItems, setTorrents]);

  // Fetch items based on the current type
  const fetchItems = useMemo(() => {
    return (bypassCache) => {
      switch (type) {
        case 'all':
          // For 'all' type, fetch all types
          return Promise.all([
            fetchLocalItems(bypassCache, 'torrents'),
            fetchLocalItems(bypassCache, 'usenet'),
            fetchLocalItems(bypassCache, 'webdl')
          ]);
        case 'usenet':
          return fetchLocalItems(bypassCache, 'usenet');
        case 'webdl':
          return fetchLocalItems(bypassCache, 'webdl');
        default:
          return fetchLocalItems(bypassCache, 'torrents');
      }
    };
  }, [type, fetchLocalItems]);

  // Check for active automation rules
  const checkActiveRules = useCallback(() => {
    const rules = localStorage.getItem('torboxAutomationRules');
    if (rules) {
      try {
        const parsedRules = JSON.parse(rules);
        const activeRules = parsedRules.filter((rule) => rule.enabled);
        setHasActiveRules(activeRules.length > 0);
      } catch (error) {
        console.error('Error parsing automation rules from localStorage:', error);
        setHasActiveRules(false);
      }
    } else {
      setHasActiveRules(false);
    }
  }, []);

  // Listen for changes in automation rules
  useEffect(() => {
    checkActiveRules();

    const handleStorageChange = (e) => {
      if (e.key === 'torboxAutomationRules') {
        checkActiveRules();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [checkActiveRules]);

  // Polling for new items
  useEffect(() => {
    let interval;
    let lastInactiveTime = null;
    let isVisible = document.visibilityState === 'visible';
    let currentPollingInterval = ACTIVE_POLLING_INTERVAL;

    // Setup cleanup interval for the active type
    let cleanupInterval;
    if (!rateLimitDataRef.current[type]) {
      rateLimitDataRef.current[type] = {
        callTimestamps: [],
        lastFetchTime: 0,
        latestFetchId: 0,
      };
    }

    cleanupInterval = setInterval(() => {
      const now = Date.now();
      const rateData = rateLimitDataRef.current[type];
      if (rateData) {
        rateData.callTimestamps = rateData.callTimestamps
          .filter((timestamp) => now - timestamp < WINDOW_SIZE)
          .slice(-MAX_CALLS);
      }
    }, WINDOW_SIZE);

    const shouldKeepFastPolling = () => {
      // Keep fast polling for torrents with auto-start enabled and queued items
      if (type === 'torrents') {
        const options = getAutoStartOptions();
        if (options?.autoStart && torrentsRef.current.some(isQueuedItem)) {
          return true;
        }
      }
      // Keep polling if there are active automation rules
      if (hasActiveRules) {
        return true;
      }
      return false;
    };

    const startPolling = () => {
      stopPolling(); // Clear any existing interval first

      // Determine polling interval based on visibility and auto-start conditions
      if (isVisible) {
        currentPollingInterval = ACTIVE_POLLING_INTERVAL;
      } else if (shouldKeepFastPolling()) {
        currentPollingInterval = hasActiveRules
          ? AUTOMATION_POLLING_INTERVAL
          : INACTIVE_POLLING_INTERVAL;
      }

      // Only start polling if visible or should keep fast polling
      if (isVisible || shouldKeepFastPolling()) {
        interval = setInterval(() => {
          // Check rate limiting for current type
          if (!isRateLimited()) {
            fetchLocalItems(true);
          }
        }, currentPollingInterval);
      }
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibilityChange = () => {
      isVisible = document.visibilityState === 'visible';

      if (isVisible) {
        const inactiveDuration = lastInactiveTime
          ? Date.now() - lastInactiveTime
          : 0;
        // Only fetch if we've been inactive for a while and not rate limited
        if (inactiveDuration > 10000 && !isRateLimited()) {
          fetchLocalItems(true);
        }
        lastInactiveTime = null;
      } else {
        lastInactiveTime = Date.now();
      }

      // Start or stop polling based on visibility
      if (isVisible || shouldKeepFastPolling()) {
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Initial polling start
    startPolling();

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      if (cleanupInterval) clearInterval(cleanupInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchLocalItems, isRateLimited, type, hasActiveRules]);

  // Return all data types and their setters
  return {
    loading,
    error,
    items,
    setItems,
    fetchItems,
  };
}
