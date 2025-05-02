import fs from 'fs';
import webpackPaths from '../webpack_configs/webpack.paths';

const { srcNodeModulesPath, appNodeModulesPath } = webpackPaths;

if (fs.existsSync(appNodeModulesPath)) {
  if (!fs.existsSync(srcNodeModulesPath)) {
    fs.symlinkSync(appNodeModulesPath, srcNodeModulesPath, 'junction');
  }
}
