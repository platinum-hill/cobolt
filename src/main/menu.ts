import {
  app,
  Menu,
  shell,
  BrowserWindow,
  MenuItemConstructorOptions,
} from 'electron';
import log from 'electron-log/main';

interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
  selector?: string;
  submenu?: DarwinMenuItemConstructorOptions[] | Menu;
}

export default class MenuBuilder {
  mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  buildMenu(): Menu {
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true'
    ) {
      this.setupDevelopmentEnvironment();
    }

    const template =
      process.platform === 'darwin'
        ? this.buildDarwinTemplate()
        : this.buildDefaultTemplate();

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    return menu;
  }

  setupDevelopmentEnvironment(): void {
    this.mainWindow.webContents.on('context-menu', (_, props) => {
      const { x, y } = props;
      const { selectionText, editFlags } = props;

      const menuItems: MenuItemConstructorOptions[] = [];

      // Add standard editing options based on context
      if (editFlags.canUndo) {
        menuItems.push({ label: 'Undo', role: 'undo' });
      }
      if (editFlags.canRedo) {
        menuItems.push({ label: 'Redo', role: 'redo' });
      }
      if (menuItems.length > 0) {
        menuItems.push({ type: 'separator' });
      }

      if (editFlags.canCut) {
        menuItems.push({ label: 'Cut', role: 'cut' });
      }
      if (editFlags.canCopy || selectionText) {
        menuItems.push({ label: 'Copy', role: 'copy' });
      }
      if (editFlags.canPaste) {
        menuItems.push({ label: 'Paste', role: 'paste' });
      }
      if (editFlags.canSelectAll) {
        menuItems.push({ label: 'Select All', role: 'selectAll' });
      }

      // Add separator before developer options if we have standard items
      if (menuItems.length > 0) {
        menuItems.push({ type: 'separator' });
      }

      // Add developer option
      menuItems.push({
        label: 'Inspect element',
        click: () => {
          this.mainWindow.webContents.inspectElement(x, y);
        },
      });

      Menu.buildFromTemplate(menuItems).popup({ window: this.mainWindow });
    });
  }

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    const subMenuAbout: DarwinMenuItemConstructorOptions = {
      label: 'Cobolt',
      submenu: [
        {
          label: 'About Cobolt',
          selector: 'orderFrontStandardAboutPanel:',
        },
        { type: 'separator' },
        { label: 'Services', submenu: [] },
        { type: 'separator' },
        {
          label: 'Hide Cobolt',
          accelerator: 'Command+H',
          selector: 'hide:',
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          selector: 'hideOtherApplications:',
        },
        { label: 'Show All', selector: 'unhideAllApplications:' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    };
    const subMenuEdit: DarwinMenuItemConstructorOptions = {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Command+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+Command+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Command+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'Command+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'Command+V', selector: 'paste:' },
        {
          label: 'Select All',
          accelerator: 'Command+A',
          selector: 'selectAll:',
        },
      ],
    };
    const subMenuViewDev: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Command+R',
          click: () => {
            this.mainWindow.webContents.reload();
          },
        },
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Command+F',
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          },
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+Command+I',
          click: () => {
            this.mainWindow.webContents.toggleDevTools();
          },
        },
      ],
    };
    const subMenuViewProd: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Command+F',
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          },
        },
      ],
    };
    const subMenuWindow: DarwinMenuItemConstructorOptions = {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'Command+M',
          selector: 'performMiniaturize:',
        },
        { label: 'Close', accelerator: 'Command+W', selector: 'performClose:' },
        { type: 'separator' },
        { label: 'Bring All to Front', selector: 'arrangeInFront:' },
      ],
    };
    const subMenuHelp: MenuItemConstructorOptions = {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click() {
            shell.openExternal('https://github.com/platinum-hill/cobolt');
          },
        },
        {
          label: 'Contribute',
          click() {
            shell.openExternal(
              'https://github.com/platinum-hill/cobolt/blob/main/CONTRIBUTING.md',
            );
          },
        },
        {
          label: 'Search Issues',
          click() {
            shell.openExternal(
              'https://github.com/platinum-hill/cobolt/issues',
            );
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: () => {
            log.info('[Menu] Check for Updates clicked');
            this.mainWindow.webContents.send('check-for-updates-menu');
            log.info('[Menu] Sent check-for-updates-menu event to renderer');
          },
        },
      ],
    };

    const subMenuView =
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true'
        ? subMenuViewDev
        : subMenuViewProd;

    // Cast to MenuItemConstructorOptions[] for compatibility with Menu.buildFromTemplate
    return [
      subMenuAbout,
      subMenuEdit,
      subMenuView,
      subMenuWindow,
      subMenuHelp,
    ] as MenuItemConstructorOptions[];
  }

  buildDefaultTemplate(): MenuItemConstructorOptions[] {
    const templateDefault: MenuItemConstructorOptions[] = [
      {
        label: '&File',
        submenu: [
          {
            label: '&Open',
            accelerator: 'Ctrl+O',
          },
          {
            label: '&Close',
            accelerator: 'Ctrl+W',
            click: () => {
              this.mainWindow.close();
            },
          },
        ],
      },
      {
        label: '&View',
        submenu:
          process.env.NODE_ENV === 'development' ||
          process.env.DEBUG_PROD === 'true'
            ? [
                {
                  label: '&Reload',
                  accelerator: 'Ctrl+R',
                  click: () => {
                    this.mainWindow.webContents.reload();
                  },
                },
                {
                  label: 'Toggle &Full Screen',
                  accelerator: 'F11',
                  click: () => {
                    this.mainWindow.setFullScreen(
                      !this.mainWindow.isFullScreen(),
                    );
                  },
                },
                {
                  label: 'Toggle &Developer Tools',
                  accelerator: 'Alt+Ctrl+I',
                  click: () => {
                    this.mainWindow.webContents.toggleDevTools();
                  },
                },
              ]
            : [
                {
                  label: 'Toggle &Full Screen',
                  accelerator: 'F11',
                  click: () => {
                    this.mainWindow.setFullScreen(
                      !this.mainWindow.isFullScreen(),
                    );
                  },
                },
              ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Learn More',
            click() {
              shell.openExternal('https://github.com/platinum-hill/cobolt');
            },
          },
          {
            label: 'Contribute',
            click() {
              shell.openExternal(
                'https://github.com/platinum-hill/cobolt/blob/main/CONTRIBUTING.md',
              );
            },
          },
          {
            label: 'Search Issues',
            click() {
              shell.openExternal(
                'https://github.com/platinum-hill/cobolt/issues',
              );
            },
          },
          { type: 'separator' },
          {
            label: 'Check for Updates...',
            click: () => {
              log.info('[Menu] Check for Updates clicked');
              this.mainWindow.webContents.send('check-for-updates-menu');
              log.info('[Menu] Sent check-for-updates-menu event to renderer');
            },
          },
        ],
      },
    ];

    return templateDefault;
  }
}
