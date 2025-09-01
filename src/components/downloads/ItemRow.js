'use client';

import {
  formatSize,
  formatSpeed,
  formatEta,
  timeAgo,
  formatDate,
} from './utils/formatters';
import DownloadStateBadge from './DownloadStateBadge';
import ItemActions from './ItemActions';
import Tooltip from '@/components/shared/Tooltip';
import { useTranslations } from 'next-intl';

export default function ItemRow({
  item,
  activeColumns,
  selectedItems,
  setSelectedItems,
  handleItemSelection,
  setItems,
  downloadHistory,
  setDownloadHistory,
  onRowSelect,
  expandedItems,
  toggleFiles,
  apiKey,
  onDelete,
  rowIndex,
  setToast,
  activeType = 'torrents',
  isMobile = false,
  isBlurred = false,
  viewMode = 'table',
}) {
  const commonT = useTranslations('Common');
  
  const renderDownloadProgress = (item) => {
    // Only show progress for active downloads
    if (!item.active || item.download_finished) {
      return <span className="text-primary-text/40 dark:text-primary-text-dark/40">-</span>;
    }

    const downloadSpeed = item.download_speed || 0;
    const totalSize = item.size || 0;
    
    // For usenet and webdl, use the progress field if available
    // For torrents, calculate from total_downloaded if available
    let progress = 0;
    let downloadedSize = 0;
    
    if (item.assetType === 'usenet' || item.assetType === 'webdl') {
      // Use progress field (0-1) for usenet and webdl
      progress = (item.progress || 0) * 100;
      downloadedSize = totalSize * (item.progress || 0);
    } else {
      // For torrents, use total_downloaded if available, otherwise fall back to progress
      downloadedSize = item.total_downloaded || 0;
      if (totalSize > 0 && downloadedSize > 0) {
        progress = (downloadedSize / totalSize) * 100;
      } else if (item.progress !== undefined) {
        progress = (item.progress || 0) * 100;
        downloadedSize = totalSize * (item.progress || 0);
      }
    }
    
    // Calculate ETA based on remaining size and speed
    const remainingSize = totalSize - downloadedSize;
    const etaSeconds = downloadSpeed > 0 ? remainingSize / downloadSpeed : 0;

    return (
      <div className="flex flex-col gap-1 min-w-0">
        {/* Progress bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div 
            className="bg-accent dark:bg-accent-dark h-2 rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
        
        {/* Progress text */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-primary-text/70 dark:text-primary-text-dark/70">
            {progress.toFixed(1)}%
          </span>
          <span className="text-primary-text/60 dark:text-primary-text-dark/60">
            {formatSize(downloadedSize)} / {formatSize(totalSize)}
          </span>
        </div>
        
        {/* Speed and ETA */}
        {downloadSpeed > 0 && (
          <div className="flex items-center justify-between text-xs text-primary-text/60 dark:text-primary-text-dark/60">
            <span>↓ {formatSpeed(downloadSpeed)}</span>
            {etaSeconds > 0 && (
              <span>ETA: {formatEta(etaSeconds, commonT)}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCell = (columnId) => {
    const baseStyle = {};

    switch (columnId) {
      case 'name':
        return (
          <td
            key={columnId}
            className="px-3 md:px-4 py-4 max-w-[150px] relative"
            style={baseStyle}
          >
            <div
              className={`text-sm text-primary-text dark:text-primary-text-dark ${
                isMobile ? 'break-all' : 'whitespace-nowrap truncate'
              } flex-1 cursor-pointer ${isBlurred ? 'blur-[6px] select-none' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Tooltip content={item.cached ? 'Cached' : 'Not cached'}>
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      item.cached
                        ? 'bg-label-success-text-dark dark:bg-label-success-text-dark'
                        : 'bg-label-danger-text-dark dark:bg-label-danger-text-dark'
                    }`}
                  ></span>
                </Tooltip>
                {item.name && (
                  <Tooltip content={!isBlurred ? item.name : ''}>
                    <span>{item.name || 'Unnamed Item'}</span>
                  </Tooltip>
                )}
              </div>
            </div>
            {/* Show additional info on mobile */}
            {isMobile && (
              <div className="flex flex-col mt-1 text-xs text-primary-text/60 dark:text-primary-text-dark/60">
                <div className="flex flex-col items-start gap-2">
                  {item.download_state && (
                    <DownloadStateBadge item={item} size="xs" />
                  )}
                  <span>{formatSize(item.size || 0)}</span>
                  {item.created_at && (
                    <span>{timeAgo(item.created_at, commonT)}</span>
                  )}
                </div>
              </div>
            )}
          </td>
        );
      case 'size':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {formatSize(item.size || 0)}
          </td>
        );
      case 'created_at':
      case 'cached_at':
      case 'updated_at':
      case 'expires_at':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70 relative group"
            style={baseStyle}
          >
            <div className="cursor-default">
              {item[columnId] ? (
                <>
                  <Tooltip content={formatDate(item[columnId])}>
                    <span>{timeAgo(item[columnId], commonT)}</span>
                  </Tooltip>
                </>
              ) : (
                'Unknown'
              )}
            </div>
          </td>
        );
      case 'download_state':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap"
            style={baseStyle}
          >
            <DownloadStateBadge item={item} />
          </td>
        );
      case 'progress':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
              <div
                className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full"
                style={{ width: `${(item.progress || 0) * 100}%` }}
              ></div>
            </div>
            <span className="text-xs">
              {((item.progress || 0) * 100).toFixed(1)}%
            </span>
          </td>
        );
      case 'download_progress':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {renderDownloadProgress(item)}
          </td>
        );
      case 'ratio':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {(item.ratio || 0).toFixed(2)}
          </td>
        );
      case 'download_speed':
      case 'upload_speed':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {formatSpeed(item[columnId])}
          </td>
        );
      case 'eta':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {formatEta(item.eta, commonT)}
          </td>
        );
      case 'id':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {item.id}
          </td>
        );
      case 'total_uploaded':
      case 'total_downloaded':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {formatSize(item[columnId] || 0)}
          </td>
        );
      case 'seeds':
      case 'peers':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {item[columnId] || 0}
          </td>
        );
      case 'file_count':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {item.files?.length || 0}
          </td>
        );
      case 'asset_type':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${
                item.assetType === 'torrents' ? 'bg-blue-500' :
                item.assetType === 'usenet' ? 'bg-green-500' :
                item.assetType === 'webdl' ? 'bg-purple-500' : 'bg-gray-500'
              }`}></span>
              <span className="capitalize">
                {item.assetType === 'torrents' ? 'Torrent' :
                 item.assetType === 'usenet' ? 'Usenet' :
                 item.assetType === 'webdl' ? 'Web' : 'Unknown'}
              </span>
            </div>
          </td>
        );
      case 'error':
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-red-500"
            style={baseStyle}
          >
            {item.error || ''}
          </td>
        );
      default:
        return (
          <td
            key={columnId}
            className="px-4 py-4 whitespace-nowrap text-sm text-primary-text/70 dark:text-primary-text-dark/70"
            style={baseStyle}
          >
            {item[columnId]}
          </td>
        );
    }
  };

  // For mobile, we'll only show the name column
  const visibleColumns = isMobile ? ['name'] : activeColumns;

  const isDownloaded = downloadHistory.some(
    (download) => download.itemId === item.id && !download.fileId,
  );

  return (
    <tr
      className={`${
        selectedItems.items?.has(item.id)
          ? 'bg-surface-alt-selected hover:bg-surface-alt-selected-hover dark:bg-surface-alt-selected-dark dark:hover:bg-surface-alt-selected-hover-dark'
          : isDownloaded
            ? 'bg-downloaded dark:bg-downloaded-dark hover:bg-downloaded-hover dark:hover:bg-downloaded-hover-dark'
            : 'bg-surface hover:bg-surface-alt-hover dark:bg-surface-dark dark:hover:bg-surface-alt-hover-dark'
      } ${!onRowSelect(item.id, selectedItems.files) && 'cursor-pointer'}`}
      onMouseDown={(e) => {
        // Prevent text selection on shift+click
        if (e.shiftKey) {
          e.preventDefault();
        }
      }}
      onClick={(e) => {
        // Ignore clicks on buttons or if has selected files
        if (
          e.target.closest('button') ||
          onRowSelect(item.id, selectedItems.files)
        )
          return;
        const isChecked = selectedItems.items?.has(item.id);
        handleItemSelection(item.id, !isChecked, rowIndex, e.shiftKey);
      }}
    >
      <td className="px-3 md:px-4 py-4 text-center whitespace-nowrap">
        <input
          type="checkbox"
          checked={selectedItems.items?.has(item.id)}
          disabled={onRowSelect(item.id, selectedItems.files)}
          onChange={(e) =>
            handleItemSelection(item.id, e.target.checked, rowIndex, e.shiftKey)
          }
          style={{ pointerEvents: 'none' }}
          className="accent-accent dark:accent-accent-dark"
        />
      </td>
      {visibleColumns.map((columnId) => renderCell(columnId))}
      <td className="px-3 md:px-4 py-4 pb-[16.5] whitespace-nowrap text-right text-sm font-medium sticky right-0 z-10 md:bg-inherit md:dark:bg-inherit">
        <ItemActions
          item={item}
          apiKey={apiKey}
          onDelete={onDelete}
          toggleFiles={toggleFiles}
          expandedItems={expandedItems}
          setItems={setItems}
          setSelectedItems={setSelectedItems}
          setToast={setToast}
          activeType={activeType}
          isMobile={isMobile}
          viewMode={viewMode}
          downloadHistory={downloadHistory}
          setDownloadHistory={setDownloadHistory}
        />
      </td>
    </tr>
  );
}
