var glob = require('glob');
glob.sync('**/test*.js', {cwd: __dirname}).forEach((test) => require('./' + test));
