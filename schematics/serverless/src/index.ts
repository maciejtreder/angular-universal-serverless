import {
    apply, chain, mergeWith, move, Rule, Tree, url, MergeStrategy, SchematicContext, SchematicsException
} from '@angular-devkit/schematics';
import {
    addDependencyToPackageJson, addOrReplaceScriptInPackageJson,
} from '@ng-toolkit/_utils';
import { getFileContent } from '@schematics/angular/utility/test';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';

export default function addServerless(options: any): Rule {
    options.serverless = {
        aws: {},
        gcloud: {}
    };

    const templateSource = apply(url('files/common'), [
        move(options.directory),
    ]);


    const rules: Rule[] = [];
    rules.push(mergeWith(templateSource, MergeStrategy.Overwrite));

    rules.push(addOrReplaceScriptInPackageJson(options,"deploy", "serverless deploy"));
    rules.push(addOrReplaceScriptInPackageJson(options,"build:deploy", "npm run build:prod && npm run deploy"));

    rules.push(addDependencyToPackageJson(options, 'serverless', '1.26.1', true));
    rules.push(addDependencyToPackageJson(options, 'ts-loader', '4.2.0', true));
    rules.push(addDependencyToPackageJson(options, 'webpack-cli', '2.1.2', true));

    if (options.provider === 'gcloud') {
        rules.push(addServerlessGcloud(options));
    } else if (options.provider === 'aws') {
        rules.push(addServerlessAWS(options));
    } else {
        options.serverless.aws.filename = 'serverless-aws.yml';
        options.serverless.gcloud.filename = 'serverless-gcloud.yml';
        rules.push(addServerlessAWS(options));
        rules.push(addServerlessGcloud(options));
        rules.push((tree: Tree, context: SchematicContext) => {
            //add scripts to package.json
            const packageJsonSource = JSON.parse(getFileContent(tree, `${options.directory}/package.json`));
            delete packageJsonSource.scripts['build:deploy'];

            packageJsonSource.scripts['build:deploy:aws'] = 'npm run build:prod && npm run deploy:aws';
            packageJsonSource.scripts['build:deploy:gcloud'] = 'npm run build:prod && npm run deploy:gcloud';
            packageJsonSource.scripts['deploy:aws'] = 'cp-cli serverless-aws.yml serverless.yml && npm run deploy';
            packageJsonSource.scripts['deploy:gcloud'] = 'cp-cli serverless-gcloud.yml serverless.yml && npm run deploy';

            tree.overwrite(`${options.directory}/package.json`, JSON.stringify(packageJsonSource, null, "  "));

            if (!options.skipInstall) {
                context.addTask(new NodePackageInstallTask(options.directory));
            }

            return tree;
        });
    }

    rules.push(addDependencyToPackageJson(options, 'opencollective', '^1.0.3', true));
    rules.push((tree: Tree) => {
        const packageJsonSource = JSON.parse(getFileContent(tree, `${options.directory}/package.json`));

        packageJsonSource['collective'] = {
            type: 'opencollective',
            url: 'https://opencollective.com/ng-toolkit'
        };
        if (packageJsonSource.scripts['postinstall'] && packageJsonSource.scripts['postinstall'].indexOf('opencollective') == -1) {
            packageJsonSource.scripts['postinstall'] += ' && opencollective postinstall'
        } else {
            packageJsonSource.scripts['postinstall'] = 'opencollective postinstall'
        }

        const universal:boolean = isUniversal(tree, options);
        if(universal) {
            packageJsonSource.scripts['build:client-and-server-bundles'] = 'ng build --prod && ng run application:server';
            packageJsonSource.scripts['build:prod'] = 'npm run build:client-and-server-bundles && webpack --config webpack.server.config.js --progress --colors';
            tree.rename(`${options.directory}/server_universal.ts`, `${options.directory}/server.ts`);
            tree.rename(`${options.directory}/server_static.ts`, `${options.directory}/temp/server_static.ts${new Date().getDate()}`);
        } else {
            packageJsonSource.scripts['build:prod'] = 'ng build --prod && webpack --config webpack.server.config.js --progress --colors';
            rules.push(addOrReplaceScriptInPackageJson(options,"build:prod", "ng build --prod && webpack --config webpack.server.config.js --progress --colors"));
            tree.rename(`${options.directory}/server_universal.ts`, `${options.directory}temp/server_universal.ts${new Date().getDate()}`);
            tree.rename(`${options.directory}/server_static.ts`, `${options.directory}/server.ts`);
        }

        tree.overwrite(`${options.directory}/package.json`, JSON.stringify(packageJsonSource, null, "  "));

        const serverFileContent = getFileContent(tree, `${options.directory}/server.ts`);

        tree.overwrite(`${options.directory}/server.ts`, serverFileContent
            .replace('__distBrowserFolder__', getBrowserDistFolder(tree, options))
            .replace('__distServerFolder__', getServerDistFolder(tree, options))
        );

        return tree;
    });


    return chain(rules);
}

function addServerlessAWS(options: any): Rule {
    const fileName = options.serverless.aws.filename || 'serverless.yml';

    const source = apply(url('./files/aws'), [
        move(options.directory)
    ]);

    return chain([
        mergeWith(source),
        tree => {
            tree.rename(`${options.directory}/serverless-aws.yml`, `${options.directory}/${fileName}`);
            tree.overwrite(`${options.directory}/${fileName}`, getFileContent(tree,`${options.directory}/${fileName}`).replace('__appName__', options.project));
            return tree;
        },

        addDependencyToPackageJson(options, 'aws-serverless-express', '^3.2.0' ),
        addDependencyToPackageJson(options, 'serverless-apigw-binary', '^0.4.4', true )
    ]);
}

function addServerlessGcloud(options: any): Rule {
    const fileName = options.serverless.gcloud.filename || 'serverless.yml';

    const source = apply(url('./files/gcloud'), [
        move(options.directory)
    ]);

    return chain([
        mergeWith(source),
        tree => {
            tree.rename(`${options.directory}/serverless-gcloud.yml`, `${options.directory}/${fileName}`);
            tree.overwrite(`${options.directory}/${fileName}`, getFileContent(tree,`${options.directory}/${fileName}`).replace('__appName__', options.project));
            return tree;
        },

        addDependencyToPackageJson(options, 'firebase-admin', '^5.11.0' ),
        addDependencyToPackageJson(options, 'firebase-functions', '^0.9.1' ),
        addDependencyToPackageJson(options, 'serverless-google-cloudfunctions', '^1.1.1', true )
    ]);
}

function isUniversal(tree: Tree, options: any): boolean {
    const cliConfig: any = JSON.parse(getFileContent(tree, `${options.directory}/angular.json`));
    const project: any = cliConfig.projects[options.project].architect;
    for (let property in project) {
        if (project.hasOwnProperty(property) && project[property].builder === '@angular-devkit/build-angular:server') {
            return true;
        }
    }
    return false;
}

function getServerDistFolder(tree: Tree, options: any): string {
    const cliConfig: any = JSON.parse(getFileContent(tree, `${options.directory}/angular.json`));
    const project: any = cliConfig.projects[options.project].architect;
    for (let property in project) {
        if (project.hasOwnProperty(property) && project[property].builder === '@angular-devkit/build-angular:server') {
            return project[property].options.outputPath;
        }
    }
    return '';
}

function getBrowserDistFolder(tree: Tree, options: any): string {
    const cliConfig: any = JSON.parse(getFileContent(tree, `${options.directory}/angular.json`));
    const project: any = cliConfig.projects[options.project].architect;
    for (let property in project) {
        if (project.hasOwnProperty(property) && project[property].builder === '@angular-devkit/build-angular:browser') {
            return project[property].options.outputPath;
        }
    }
    throw new SchematicsException('browser nor server builder not found!');
}