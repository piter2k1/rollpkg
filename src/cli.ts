#!/usr/bin/env node

import { checkInvariantsAndGetConfiguration } from './configureRollpkg';
import {
  calculateBundlephobiaStats,
  printBundlephobiaStats,
} from './bundlephobiaStats';
import {
  createRollupConfig,
  rollupWatch,
  createBundles,
  writeBundles,
} from './rollupBuilds';
import { progressEstimator, cleanDist } from './utils';
import {
  EXIT_ON_ERROR,
  errorAsObjectWithMessage,
  logError,
  logRollpkgError,
  logTsError,
} from './errorUtils';

const rollpkg = async () => {
  /////////////////////////////////////
  // clean dist folder
  const cleanDistMessage = 'Cleaning dist folder';
  try {
    const clean = cleanDist();
    await progressEstimator(clean, cleanDistMessage);
  } catch (error) {
    logError({
      failedAt: cleanDistMessage,
      message: errorAsObjectWithMessage(error).message,
      fullError: error,
    });
    throw EXIT_ON_ERROR;
  }
  /////////////////////////////////////

  /////////////////////////////////////
  // rollpkg invariants and configuration
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const invariantsAndConfigurationMessage = 'Checking rollpkg invariants';
  let rollpkgConfiguration;

  try {
    rollpkgConfiguration = checkInvariantsAndGetConfiguration({ args, cwd });
    await progressEstimator(
      rollpkgConfiguration,
      invariantsAndConfigurationMessage,
    );
  } catch (error) {
    logRollpkgError({
      failedAt: invariantsAndConfigurationMessage,
      message: errorAsObjectWithMessage(error).message,
    });
    throw EXIT_ON_ERROR;
  }

  const {
    watchMode,
    entryFile,
    kebabCasePkgName,
    pkgJsonSideEffects,
    pkgJsonDependencyKeys,
    pkgJsonPeerDependencyKeys,
    pkgJsonUmdName,
    pkgJsonUmdGlobalDependencies,
  } = await rollpkgConfiguration;
  /////////////////////////////////////

  /////////////////////////////////////
  // create rollup config
  const rollupConfigurationMessage = 'Creating rollup config';
  let rollupConfiguration;

  try {
    rollupConfiguration = createRollupConfig({
      kebabCasePkgName,
      pkgJsonSideEffects,
      pkgJsonPeerDependencyKeys,
      pkgJsonUmdName,
      pkgJsonUmdGlobalDependencies,
    });
    await progressEstimator(Promise.resolve(), rollupConfigurationMessage);
  } catch (error) {
    logError({
      failedAt: rollupConfigurationMessage,
      message: errorAsObjectWithMessage(error).message,
      fullError: error,
    });
    throw EXIT_ON_ERROR;
  }

  const {
    buildPlugins,
    prodBuildPlugins,
    outputPlugins,
    outputProdPlugins,
    treeshakeOptions,
    umdNameForPkg,
    umdExternalDependencies,
    umdDependencyGlobals,
  } = rollupConfiguration;
  /////////////////////////////////////

  /////////////////////////////////////
  // rollup watch
  if (watchMode) {
    rollupWatch({
      kebabCasePkgName,
      pkgJsonDependencyKeys,
      pkgJsonPeerDependencyKeys,
      entryFile,
      treeshakeOptions,
      buildPlugins,
      outputPlugins,
    });
    return;
  }
  /////////////////////////////////////

  /////////////////////////////////////
  // create rollup bundles
  const createRollupBundlesMessage = 'Creating esm, cjs, umd builds';
  let bundles;

  try {
    bundles = createBundles({
      entryFile,
      pkgJsonDependencyKeys,
      pkgJsonPeerDependencyKeys,
      umdExternalDependencies,
      treeshakeOptions,
      buildPlugins,
      prodBuildPlugins,
    });
    await progressEstimator(bundles, createRollupBundlesMessage, {
      id: `${kebabCasePkgName}-${createRollupBundlesMessage}`,
    });
  } catch (error) {
    const errorAsObject = errorAsObjectWithMessage(error);
    // rpt2 is the rollup typescript plugin
    if (errorAsObject.plugin === 'rpt2') {
      logTsError({
        failedAt: createRollupBundlesMessage,
        message: errorAsObject.message,
      });
    } else {
      logError({
        failedAt: createRollupBundlesMessage,
        message: errorAsObject.message,
        fullError: error,
      });
    }
    throw EXIT_ON_ERROR;
  }

  const [bundle, bundleProd, bundleUmd, bundleUmdProd] = await bundles;
  /////////////////////////////////////

  /////////////////////////////////////
  // write rollup bundles
  const writeRollupBundlesMessage = 'Writing esm, cjs, umd builds';

  try {
    const output = writeBundles({
      kebabCasePkgName,
      bundle,
      bundleProd,
      bundleUmd,
      bundleUmdProd,
      outputPlugins,
      outputProdPlugins,
      umdNameForPkg,
      umdDependencyGlobals,
    });
    await progressEstimator(output, writeRollupBundlesMessage, {
      id: `${kebabCasePkgName}-${writeRollupBundlesMessage}`,
    });
  } catch (error) {
    logError({
      failedAt: writeRollupBundlesMessage,
      message: errorAsObjectWithMessage(error).message,
      fullError: error,
    });
    throw EXIT_ON_ERROR;
  }
  /////////////////////////////////////

  /////////////////////////////////////
  // rollpkg build success!
  await progressEstimator(Promise.resolve(), 'ROLLPKG BUILD SUCCESS 😁😘');
  /////////////////////////////////////

  /////////////////////////////////////
  // calculate bundlephobia package stats
  const bundlephobiaStatsMessage = 'Calculating Bundlephobia stats';

  try {
    const packageStats = calculateBundlephobiaStats({ cwd });

    await progressEstimator(packageStats, bundlephobiaStatsMessage, {
      id: `${kebabCasePkgName}-${bundlephobiaStatsMessage}`,
    });

    printBundlephobiaStats(await packageStats);
  } catch (error) {
    logError({
      failedAt: bundlephobiaStatsMessage,
      message: `Bundlephobia Error: ${errorAsObjectWithMessage(error).message}`,
    });
    // don' throw EXIT_ON_ERROR because the build has already succeeded
    // and an error in stats calculation shouldn't cause `rollpkg build` to fail
  }
  /////////////////////////////////////
};

// always exit 0 in watch mode so can chain in npm scripts: rollpkg watch && ...
const exitCode = process.argv[2] === 'watch' ? 0 : 1;

rollpkg().catch((error) => {
  if (error === EXIT_ON_ERROR) {
    // only clean dist if it's a known error
    cleanDist().finally(() => {
      process.exit(exitCode);
    });
  } else {
    // unknown error, throw it and leave dist as it is
    throw error;
  }
});
