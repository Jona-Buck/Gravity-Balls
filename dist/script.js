var bgUrl = 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=1427&q=80';

var BASE_RADIUS = 10;
var BASE_GRAVITY = 0.05;
var LENS_MASS = 10;
var MERGE_FACTOR = 0.85;
var EXPLOSION_RADIUS_LIMIT = 65;
var FRAGMENT_COUNT = 8;
var EXPLOSION_COOLDOWN = 1200;

var blackholes = [];
var explosions = [];
var canvas, gl, fxCanvas, fxContext, program, quadBuffer, backgroundTexture;
var renderTargets = [];
var targetWidth = 0, targetHeight = 0;
var locationOfResolution, locationOfCenter, locationOfMass, locationOfImage;
var startTime = Date.now();

function makeBlackHole(x, y, options) {
	options = options || {};
	return {
		x: x, y: y,
		radius: options.radius || BASE_RADIUS,
		currentRadius: options.currentRadius !== undefined ? options.currentRadius : BASE_RADIUS * 0.5,
		radiusEase: 0,
		gravity: options.gravity !== undefined ? options.gravity : BASE_GRAVITY,
		mass: options.mass !== undefined ? options.mass : 0,
		bodyCount: options.bodyCount !== undefined ? options.bodyCount : 1,
		vx: options.vx || 0, vy: options.vy || 0,
		burstFrames: options.burstFrames || 0,
		mergeCooldownUntil: options.mergeCooldownUntil || 0
	};
}

function addBlackHole(event) {
	var rect = canvas.getBoundingClientRect();
	if (!rect.width || !rect.height) return;
	var x = (event.clientX - rect.left) / rect.width * canvas.width;
	var y = (event.clientY - rect.top) / rect.height * canvas.height;
	if (x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height) {
		blackholes.push(makeBlackHole(x, y));
	}
}

function compileShader(type, source) {
	var shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		var message = gl.getShaderInfoLog(shader) || 'Shader compile error';
		gl.deleteShader(shader);
		throw new Error(message);
	}
	return shader;
}

function createProgram() {
	var vertexShader = compileShader(gl.VERTEX_SHADER, document.getElementById('2d-vertex-shader').text);
	var fragmentShader = compileShader(gl.FRAGMENT_SHADER, document.getElementById('2d-fragment-shader').text);
	var result = gl.createProgram();
	gl.attachShader(result, vertexShader);
	gl.attachShader(result, fragmentShader);
	gl.linkProgram(result);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
		var message = gl.getProgramInfoLog(result) || 'Program link error';
		gl.deleteProgram(result);
		throw new Error(message);
	}
	return result;
}

function createBackgroundTexture(image) {
	backgroundTexture = gl.createTexture();
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
}

function deleteRenderTargets() {
	for (var i = 0; i < renderTargets.length; i++) {
		gl.deleteTexture(renderTargets[i].texture);
		gl.deleteFramebuffer(renderTargets[i].framebuffer);
	}
	renderTargets = [];
	targetWidth = targetHeight = 0;
}

function createRenderTarget() {
	var texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

	var framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		gl.deleteTexture(texture);
		gl.deleteFramebuffer(framebuffer);
		throw new Error('Framebuffer incomplete: ' + status);
	}
	return { texture: texture, framebuffer: framebuffer };
}

function ensureRenderTargets() {
	if (renderTargets.length === 2 && targetWidth === canvas.width && targetHeight === canvas.height) return;
	deleteRenderTargets();
	renderTargets.push(createRenderTarget(), createRenderTarget());
	targetWidth = canvas.width;
	targetHeight = canvas.height;
}

function resizeCanvas() {
	if (!canvas || !gl) return;
	var oldWidth = canvas.width || 1;
	var oldHeight = canvas.height || 1;
	var side = Math.max(window.innerWidth, window.innerHeight);
	var scaleX = side / oldWidth;
	var scaleY = side / oldHeight;

	for (var i = 0; i < blackholes.length; i++) {
		blackholes[i].x *= scaleX;
		blackholes[i].y *= scaleY;
	}

	canvas.width = side;
	canvas.height = side;
	gl.viewport(0, 0, canvas.width, canvas.height);
	if (locationOfResolution) {
		gl.uniform2f(locationOfResolution, canvas.width, canvas.height);
	}
	deleteRenderTargets();
	if (fxCanvas) {
		fxCanvas.width = window.innerWidth;
		fxCanvas.height = window.innerHeight;
	}
}

function spawnExplosionEffect(x, y, radius, now) {
	var rect = canvas.getBoundingClientRect();
	var sx = rect.left + x / canvas.width * rect.width;
	var sy = rect.top + y / canvas.height * rect.height;
	var sparks = [];
	for (var i = 0; i < 42; i++) {
		var angle = Math.PI * 2 * i / 42 + (Math.random() - 0.5) * 0.16;
		var speed = 1.5 + Math.random() * 5.5;
		sparks.push({ x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
			life: 0.7 + Math.random() * 0.3, size: 1 + Math.random() * 2.5 });
	}
	explosions.push({ x: sx, y: sy, start: now, duration: 1150,
		maxRadius: Math.max(100, radius * 5), sparks: sparks });
}

function drawExplosionEffects(now) {
	if (!fxContext) return;
	fxContext.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
	for (var i = explosions.length - 1; i >= 0; i--) {
		var effect = explosions[i];
		var progress = (now - effect.start) / effect.duration;
		if (progress >= 1) {
			explosions.splice(i, 1);
			continue;
		}
		var alpha = Math.pow(1 - progress, 1.65);
		var ringRadius = effect.maxRadius * (0.12 + progress * 1.45);
		fxContext.save();
		fxContext.globalAlpha = alpha;
		fxContext.lineWidth = 5 * (1 - progress) + 1;
		fxContext.strokeStyle = 'rgba(145,220,255,0.95)';
		fxContext.shadowColor = 'rgba(100,190,255,0.9)';
		fxContext.shadowBlur = 24 * (1 - progress);
		fxContext.beginPath();
		fxContext.arc(effect.x, effect.y, ringRadius, 0, Math.PI * 2);
		fxContext.stroke();
		fxContext.globalAlpha = alpha * 0.55;
		fxContext.lineWidth = 2;
		fxContext.beginPath();
		fxContext.arc(effect.x, effect.y, ringRadius * 0.72, 0, Math.PI * 2);
		fxContext.stroke();
		fxContext.restore();

		for (var j = 0; j < effect.sparks.length; j++) {
			var spark = effect.sparks[j];
			if (spark.life <= 0) continue;
			spark.x += spark.vx;
			spark.y += spark.vy;
			spark.vx *= 0.975;
			spark.vy *= 0.975;
			spark.life -= 0.018;
			fxContext.save();
			fxContext.globalAlpha = Math.max(0, spark.life) * alpha;
			fxContext.fillStyle = '#b9eaff';
			fxContext.shadowColor = '#69caff';
			fxContext.shadowBlur = 12;
			fxContext.beginPath();
			fxContext.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
			fxContext.fill();
			fxContext.restore();
		}
	}
}

function explodeBlackHole(index, now) {
	var parent = blackholes[index];
	var count = FRAGMENT_COUNT;
	var fragmentRadius = parent.radius / Math.sqrt(count);
	var startAngle = Math.random() * Math.PI * 2;
	var offsetRadius = Math.max(parent.radius * 1.08, 48);
	var fragments = [];
	spawnExplosionEffect(parent.x, parent.y, parent.radius, now);

	for (var i = 0; i < count; i++) {
		var angle = startAngle + Math.PI * 2 * i / count;
		var dx = Math.cos(angle), dy = Math.sin(angle);
		fragments.push(makeBlackHole(parent.x + dx * offsetRadius, parent.y + dy * offsetRadius, {
			radius: fragmentRadius,
			currentRadius: fragmentRadius * 0.55,
			gravity: parent.gravity / count,
			mass: parent.mass / count,
			bodyCount: parent.bodyCount / count,
			vx: dx * 5.2 + parent.vx / count,
			vy: dy * 5.2 + parent.vy / count,
			burstFrames: 90,
			mergeCooldownUntil: now + EXPLOSION_COOLDOWN
		}));
	}
	blackholes.splice.apply(blackholes, [index, 1].concat(fragments));
}

function mergeBlackHoles(indexA, indexB) {
	var a = blackholes[indexA], b = blackholes[indexB];
	if (b.radius > a.radius) {
		var swap = a; a = b; b = swap;
		blackholes[indexA] = a;
		blackholes[indexB] = b;
	}

	var massA = Math.max(a.gravity, 0.000001);
	var massB = Math.max(b.gravity, 0.000001);
	var totalMass = massA + massB;
	a.x = (a.x * massA + b.x * massB) / totalMass;
	a.y = (a.y * massA + b.y * massB) / totalMass;
	a.vx = (a.vx * massA + b.vx * massB) / totalMass;
	a.vy = (a.vy * massA + b.vy * massB) / totalMass;

	var areaA = a.radius * a.radius;
	var areaB = b.radius * b.radius;
	a.gravity += b.gravity;
	a.mass += b.mass;
	a.bodyCount += b.bodyCount;
	a.radius = Math.sqrt(areaA + areaB);
	a.currentRadius = Math.sqrt(areaA + areaB * 3);
	a.radiusEase = 0;
	a.burstFrames = Math.max(a.burstFrames, b.burstFrames);
	a.mergeCooldownUntil = Math.max(a.mergeCooldownUntil, b.mergeCooldownUntil);
	blackholes.splice(indexB, 1);
}

function resolveMergers(now) {
	var changed = true;
	while (changed) {
		changed = false;
		mergeSearch:
		for (var i = 0; i < blackholes.length; i++) {
			var a = blackholes[i];
			if (a.mergeCooldownUntil > now) continue;
			for (var j = i + 1; j < blackholes.length; j++) {
				var b = blackholes[j];
				if (b.mergeCooldownUntil > now) continue;
				var dx = b.x - a.x, dy = b.y - a.y;
				var distance = Math.sqrt(dx * dx + dy * dy);
				var mature = a.currentRadius >= b.radius || b.currentRadius >= a.radius;
				var touching = distance < (a.currentRadius + b.currentRadius) * MERGE_FACTOR;
				if (mature && touching) {
					mergeBlackHoles(i, j);
					changed = true;
					if (blackholes[i].currentRadius > EXPLOSION_RADIUS_LIMIT) explodeBlackHole(i, now);
					break mergeSearch;
				}
			}
		}
	}
}

function updatePhysics(now) {
	for (var i = 0; i < blackholes.length; i++) {
		var hole = blackholes[i];
		hole.radiusEase = (hole.radiusEase + (hole.radius - hole.currentRadius) * 0.07) * 0.95;
		hole.currentRadius += hole.radiusEase;
		if (hole.currentRadius < 0) hole.currentRadius = 0;

		var targetMass = LENS_MASS * hole.bodyCount;
		if (hole.mass < targetMass * 0.999) hole.mass += (targetMass - hole.mass) * 0.03;

		// Only explosion fragments have extra inertial motion; normal attraction matches the reference.
		if (hole.burstFrames > 0) {
			hole.x += hole.vx;
			hole.y += hole.vy;
			hole.vx *= 0.965;
			hole.vy *= 0.965;
			hole.burstFrames--;
			if (hole.burstFrames === 0) hole.vx = hole.vy = 0;
		}
	}

	resolveMergers(now);

	// Match preview (5).html: each body attracts every other body with its gravity value.
	// Accumulate all displacements first so the result does not depend on array order.
	var moveX = new Float64Array(blackholes.length);
	var moveY = new Float64Array(blackholes.length);
	for (i = 0; i < blackholes.length; i++) {
		for (var j = i + 1; j < blackholes.length; j++) {
			var first = blackholes[i], second = blackholes[j];
			var dx = second.x - first.x, dy = second.y - first.y;
			var distance = Math.sqrt(dx * dx + dy * dy);
			if (distance < 0.0001) continue;
			var nx = dx / distance, ny = dy / distance;
			moveX[i] += nx * second.gravity;
			moveY[i] += ny * second.gravity;
			moveX[j] -= nx * first.gravity;
			moveY[j] -= ny * first.gravity;
		}
	}
	for (i = 0; i < blackholes.length; i++) {
		blackholes[i].x += moveX[i];
		blackholes[i].y += moveY[i];
	}
}

function drawQuad() {
	var position = gl.getAttribLocation(program, 'a_position');
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.enableVertexAttribArray(position);
	gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function drawPass(sourceTexture, targetFramebuffer, hole) {
	gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
	gl.viewport(0, 0, canvas.width, canvas.height);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
	gl.uniform1i(locationOfImage, 0);
	if (hole) {
		gl.uniform2f(locationOfCenter, hole.x / canvas.width, hole.y / canvas.height);
		gl.uniform1f(locationOfMass, hole.mass * 0.00001);
	} else {
		gl.uniform2f(locationOfCenter, 0, 0);
		gl.uniform1f(locationOfMass, 0);
	}
	drawQuad();
}

function renderBlackHoles() {
	gl.useProgram(program);
	if (blackholes.length <= 1 && renderTargets.length) deleteRenderTargets();
	if (blackholes.length === 0) {
		drawPass(backgroundTexture, null, null);
		return;
	}
	var sourceTexture = backgroundTexture;
	var targetIndex = 0;
	if (blackholes.length > 1) ensureRenderTargets();

	for (var i = 0; i < blackholes.length; i++) {
		var last = i === blackholes.length - 1;
		var targetFramebuffer = null;
		var nextSource = sourceTexture;
		if (!last) {
			var target = renderTargets[targetIndex];
			targetFramebuffer = target.framebuffer;
			nextSource = target.texture;
			targetIndex = 1 - targetIndex;
		}
		drawPass(sourceTexture, targetFramebuffer, blackholes[i]);
		sourceTexture = nextSource;
	}
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function render() {
	var now = Date.now();
	updatePhysics(now);
	renderBlackHoles();
	drawExplosionEffects(now);
	window.requestAnimationFrame(render);
}

function init(image) {
	canvas = document.getElementById('glscreen');
	gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
	if (!gl) throw new Error('WebGL is not available in this browser.');

	fxCanvas = document.getElementById('fxscreen');
	fxContext = fxCanvas.getContext('2d');
	resizeCanvas();
	canvas.addEventListener('click', addBlackHole);

	program = createProgram();
	gl.useProgram(program);
	locationOfResolution = gl.getUniformLocation(program, 'u_resolution');
	locationOfCenter = gl.getUniformLocation(program, 'u_center');
	locationOfMass = gl.getUniformLocation(program, 'u_mass');
	locationOfImage = gl.getUniformLocation(program, 'u_image');
	gl.uniform2f(locationOfResolution, canvas.width, canvas.height);
	gl.uniform1i(locationOfImage, 0);

	quadBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		-1, -1, 1, -1, -1, 1,
		-1, 1, 1, -1, 1, 1
	]), gl.STATIC_DRAW);

	createBackgroundTexture(image);
	render();
}

window.addEventListener('load', function() {
	var image = new Image();
	image.crossOrigin = 'Anonymous';
	image.onload = function() {
		try { init(image); }
		catch (error) { console.error('Gravity Balls initialization failed:', error); }
	};
	image.onerror = function() { console.error('Gravity Balls background image could not be loaded.'); };
	image.src = bgUrl;
});

window.addEventListener('resize', function() {
	if (canvas && gl) resizeCanvas();
});