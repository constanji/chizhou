import React, { useState, useMemo, useCallback } from 'react';
import type { TUser } from '@aipyq/data-provider';
import { Skeleton } from './Skeleton';
import { useAvatar } from '~/hooks';
import { UserIcon } from '~/svgs';

export interface AvatarProps {
  user?: TUser;
  size?: number;
  className?: string;
  alt?: string;
  showDefaultWhenEmpty?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({
  user,
  size = 32,
  className = '',
  alt,
  showDefaultWhenEmpty = true,
}) => {
  const avatarSrc = useAvatar(user);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const altText = useMemo(
    () => alt || `${user?.name || user?.username || user?.email || ''}'s avatar`,
    [alt, user?.name, user?.username, user?.email],
  );

  // 直接使用useAvatar返回的值，它已经处理了所有逻辑（有头像用头像，没有头像用logo.png）
  const imageSrc = useMemo(() => {
    if (imageError) {
      return '/assets/logo.png';
    }
    return avatarSrc || '/assets/logo.png';
  }, [avatarSrc, imageError]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoaded(false);
  }, []);

  const DefaultAvatar = useCallback(
    () => (
      <div
        style={{
          backgroundColor: 'rgb(121, 137, 255)',
          width: `${size}px`,
          height: `${size}px`,
          boxShadow: 'rgba(240, 246, 252, 0.1) 0px 0px 0px 1px',
        }}
        className={`relative flex items-center justify-center rounded-full p-1 text-text-primary ${className}`}
        aria-hidden="true"
      >
        <UserIcon />
      </div>
    ),
    [size, className],
  );

  // 如果useAvatar返回了值（头像或logo.png），显示图片
  if (avatarSrc && !imageError) {
    return (
      <div className="relative" style={{ width: `${size}px`, height: `${size}px` }}>
        {!imageLoaded && (
          <Skeleton className="rounded-full" style={{ width: `${size}px`, height: `${size}px` }} />
        )}

        <img
          style={{
            width: `${size}px`,
            height: `${size}px`,
            display: imageLoaded ? 'block' : 'none',
          }}
          className={`rounded-full ${className}`}
          src={imageSrc}
          alt={altText}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      </div>
    );
  }

  // 如果图片加载错误，显示默认图标
  if (imageError && showDefaultWhenEmpty) {
    return <DefaultAvatar />;
  }

  // 如果没有avatarSrc，显示logo.png
  if (showDefaultWhenEmpty) {
    return (
      <div className="relative" style={{ width: `${size}px`, height: `${size}px` }}>
        <img
          style={{
            width: `${size}px`,
            height: `${size}px`,
          }}
          className={`rounded-full ${className}`}
          src="/assets/logo.png"
          alt={altText}
          onError={handleImageError}
        />
      </div>
    );
  }

  return null;
};

export default Avatar;
