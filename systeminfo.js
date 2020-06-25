const si = require('systeminformation');

// callback style
si.cpu(function(data) {
	console.log('CPU-Information:');
	console.log(data);
});

si.cpuTemperature(function(data) {
	console.log('CPU Temp:');
	console.log(data);
});

//~ si.currentLoad(function(data) {
	//~ 
	//~ console.log('Load data:');
	//~ console.log(data);
//~ });

si.inetChecksite('https://mami-red.eu-gb.mybluemix.net/', function(data) {
	
	console.log('Internet check:');
	console.log(data);
});
