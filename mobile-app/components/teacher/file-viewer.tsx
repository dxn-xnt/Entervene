import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Sharing from 'expo-sharing';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

export type FileItem = {
  file_name: string;
  file_size?: number;
  file_url?: string;
  file_path?: string;
  file_id?: number;
  attachment_id?: number;
  classwork_attachment_id?: number;
};

interface FileViewerProps {
  files: FileItem[];
  isLoading?: boolean;
  onFilePress?: (file: FileItem) => void;
  canDownload?: boolean;
  canView?: boolean;
  downloadBaseUrl?: string;
  token?: string;        // JWT for authenticated downloads
  classworkId?: number;  // If set, uses /classwork/{id}/attachments/{att_id}/download
}

const getFileIcon = (fileName: string): keyof typeof Ionicons.glyphMap => {
  const name = fileName.toLowerCase();
  if (name.endsWith('.pdf')) return 'document-text-outline';
  if (name.endsWith('.doc') || name.endsWith('.docx')) return 'document-outline';
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) return 'grid-outline';
  if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'film-outline';
  if (name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return 'image-outline';
  return 'attach-outline';
};

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const FileViewerItem: React.FC<{
  file: FileItem;
  canDownload: boolean;
  canView: boolean;
  onViewPress: () => void;
  onDownloadPress: () => void;
}> = ({ file, canDownload, canView, onViewPress, onDownloadPress }) => (
  <View style={s.fileCard}>
    <View style={s.fileIconWrap}>
      <Ionicons
        name={getFileIcon(file.file_name)}
        size={24}
        color={AppColors.foreground}
      />
    </View>

    <View style={s.fileInfo}>
      <Text style={s.fileName} numberOfLines={2}>
        {file.file_name}
      </Text>
      <Text style={s.fileSize}>{formatFileSize(file.file_size)}</Text>
    </View>

    <View style={s.fileActions}>
      {canView && (
        <TouchableOpacity
          style={[s.actionBtn, s.viewBtn]}
          onPress={onViewPress}
          hitSlop={8}
        >
          <Ionicons name="open-outline" size={16} color={AppColors.primaryForeground} />
        </TouchableOpacity>
      )}
      {canDownload && (
        <TouchableOpacity
          style={[s.actionBtn, s.downloadBtn]}
          onPress={onDownloadPress}
          hitSlop={8}
        >
          <Ionicons name="download-outline" size={16} color={AppColors.foreground} />
        </TouchableOpacity>
      )}
    </View>
  </View>
);

export default function FileViewer({
  files,
  isLoading = false,
  onFilePress,
  canDownload = true,
  canView = true,
  downloadBaseUrl = '',
  token,
  classworkId,
}: FileViewerProps) {
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const API_BASE = process.env.EXPO_PUBLIC_API_URL || downloadBaseUrl;

  /** Build an authenticated download URL for this file */
  const buildFileUrl = (file: FileItem): string | null => {
    const attId = file.classwork_attachment_id || file.attachment_id || file.file_id;
    if (attId && classworkId) {
      // Classwork attachment endpoint
      const url = `${API_BASE}/api/v1/classwork-assignments/classwork/${classworkId}/attachments/${attId}/download`;
      return token ? `${url}?token=${encodeURIComponent(token)}` : url;
    }
    if (file.file_url || file.file_path) {
      return (file.file_url || file.file_path || '').startsWith('http')
        ? (file.file_url || file.file_path || '')
        : `${API_BASE}${file.file_url || file.file_path}`;
    }
    return null;
  };

  const handleViewFile = async (file: FileItem) => {
    if (onFilePress) {
      onFilePress(file);
      return;
    }

    try {
      const url = buildFileUrl(file);
      if (!url) {
        Alert.alert('Error', 'File URL not available');
        return;
      }
      await WebBrowser.openBrowserAsync(url);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to open file');
    }
  };

  const handleDownloadFile = async (file: FileItem) => {
    try {
      const attachmentId =
        file.classwork_attachment_id || file.attachment_id || file.file_id;
      if (!attachmentId) {
        Alert.alert('Error', 'Cannot download this file');
        return;
      }

      setDownloadingId(attachmentId);

      const url = buildFileUrl(file);
      if (!url) {
        Alert.alert('Error', 'File URL not available');
        return;
      }

      // Open in browser for download — token is already in the URL
      await WebBrowser.openBrowserAsync(url);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to download file');
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="large" color={AppColors.primary} />
      </View>
    );
  }

  if (!files || files.length === 0) {
    return (
      <View style={s.emptyContainer}>
        <Ionicons name="attach-outline" size={40} color={AppColors.muted} />
        <Text style={s.emptyText}>No files attached</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {files.map((file, index) => (
        <FileViewerItem
          key={index}
          file={file}
          canDownload={canDownload}
          canView={canView}
          onViewPress={() => handleViewFile(file)}
          onDownloadPress={() =>
            handleDownloadFile(file)
          }
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    gap: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: AppColors.mutedForeground,
    fontWeight: '600',
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.white,
    borderRadius: 8,
    ...NeoShadow.xs,
  },
  fileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: '#F6E9B2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  fileSize: {
    fontSize: 12,
    color: AppColors.mutedForeground,
  },
  fileActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: Borders.width,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtn: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
  },
  downloadBtn: {
    backgroundColor: AppColors.card,
    borderColor: AppColors.border,
  },
});
