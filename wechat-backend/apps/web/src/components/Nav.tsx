import {
  Badge,
  Image,
  Link,
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  Tooltip,
} from '@nextui-org/react';
import { ThemeSwitcher } from './ThemeSwitcher';
import { GitHubIcon } from './GitHubIcon';
import { useLocation } from 'react-router-dom';
import { appVersion, serverOriginUrl } from '@web/utils/env';
import { useEffect, useState } from 'react';

const navbarItemLink = [
  {
    href: '/feeds',
    name: '公众号源',
  },
  {
    href: '/accounts',
    name: '账号管理',
  },
];

const repoUrl = 'https://github.com/simon2036/wechat-obsidian-knowledge-base';
const latestReleaseApi =
  'https://api.github.com/repos/simon2036/wechat-obsidian-knowledge-base/releases/latest';

const Nav = () => {
  const { pathname } = useLocation();
  const [releaseVersion, setReleaseVersion] = useState(appVersion);

  useEffect(() => {
    fetch(latestReleaseApi)
      .then((res) => res.json())
      .then((data) => {
        if (data?.name) {
          setReleaseVersion(data.name.replace('v', ''));
        }
      })
      .catch(() => {
        setReleaseVersion(appVersion);
      });
  }, []);

  const isFoundNewVersion = releaseVersion > appVersion;

  return (
    <div>
      <Navbar isBordered>
        <Tooltip
          content={
            <div className="p-1">
              {isFoundNewVersion && (
                <Link
                  href={`${repoUrl}/releases/latest`}
                  target="_blank"
                  className="mb-1 block text-medium"
                >
                  发现新版本：v{releaseVersion}
                </Link>
              )}
              当前版本：v{appVersion}
            </div>
          }
          placement="left"
        >
          <NavbarBrand className="cursor-default">
            <Badge
              content={isFoundNewVersion ? '' : null}
              color="danger"
              size="sm"
            >
              <Image
                width={28}
                alt="WeWe RSS"
                className="mr-2"
                src={
                  serverOriginUrl
                    ? `${serverOriginUrl}/favicon.ico`
                    : 'https://r2-assets.111965.xyz/wewe-rss.png'
                }
              />
            </Badge>
            <p className="font-bold text-inherit">WeWe RSS</p>
          </NavbarBrand>
        </Tooltip>
        <NavbarContent className="hidden sm:flex gap-4" justify="center">
          {navbarItemLink.map((item) => {
            return (
              <NavbarItem
                isActive={pathname.startsWith(item.href)}
                key={item.href}
              >
                <Link color="foreground" href={item.href}>
                  {item.name}
                </Link>
              </NavbarItem>
            );
          })}
        </NavbarContent>
        <NavbarContent justify="end">
          <ThemeSwitcher />
          <Link href={repoUrl} target="_blank" color="foreground">
            <GitHubIcon />
          </Link>
        </NavbarContent>
      </Navbar>
    </div>
  );
};

export default Nav;
