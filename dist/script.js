var bgUrl = 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=1427&q=80';

var BASE_RADIUS = 10;
var BASE_GRAVITY = 0.05;
var LENS_MASS = 10;
var MERGE_FACTOR = 0.85;
var EXPLOSION_BODY_COUNT = 32;

var blackholes = [];
var explosions = [];
var canvas, gl, fxCanvas, fxContext, program, quadBuffer, backgroundTexture;
var renderTargets = [];
var targetWidth = 0, targetHeight = 0;
var locationOfResolution, locationOfCenter, locationOfMass, locationOfImage, locationOfFlipY;
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
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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

function spawnExplosionEffect(x, y, radius, now, bodyCount) {
	var rect = canvas.getBoundingClientRect();
	var sx = rect.left + x / canvas.width * rect.width;
	var sy = rect.top + y / canvas.height * rect.height;
	var particles = [];
	var particleCount = Math.min(220, 90 + bodyCount * 2);

	for (var i = 0; i < particleCount; i++) {
		var angle = Math.random() * Math.PI * 2;
		var speed = 110 + Math.random() * 520;
		var size = 0.8 + Math.random() * 2.8;
		particles.push({
			x: sx, y: sy,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			age: 0,
			life: 0.45 + Math.random() * 0.7,
			size: size,
			stretch: 0.025 + Math.random() * 0.035,
			tint: Math.random()
		});
	}

	explosions.push({
		x: sx,
		y: sy,
		start: now,
		lastFrame: now,
		duration: 1250,
		maxRadius: Math.max(150, radius * 7),
		particles: particles
	});
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

		var dt = Math.min(0.04, Math.max(0, (now - effect.lastFrame) / 1000));
		effect.lastFrame = now;

		// One broad, soft shockwave instead of thin concentric outlines.
		var waveProgress = 1 - Math.pow(1 - progress, 2.4);
		var waveRadius = effect.maxRadius * waveProgress;
		var waveWidth = 34 * (1 - progress) + 5;
		var waveAlpha = Math.sin(Math.PI * Math.pow(progress, 0.72)) * 0.72;

		fxContext.save();
		fxContext.globalCompositeOperation = 'lighter';

		var wave = fxContext.createRadialGradient(
			effect.x, effect.y, Math.max(0, waveRadius - waveWidth),
			effect.x, effect.y, waveRadius + waveWidth
		);
		wave.addColorStop(0, 'rgba(80, 170, 255, 0)');
		wave.addColorStop(0.42, 'rgba(95, 190, 255, ' + (waveAlpha * 0.12) + ')');
		wave.addColorStop(0.72, 'rgba(185, 230, 255, ' + (waveAlpha * 0.8) + ')');
		wave.addColorStop(0.88, 'rgba(255, 255, 255, ' + (waveAlpha * 0.95) + ')');
		wave.addColorStop(1, 'rgba(85, 165, 255, 0)');
		fxContext.fillStyle = wave;
		fxContext.beginPath();
		fxContext.arc(effect.x, effect.y, waveRadius + waveWidth, 0, Math.PI * 2);
		fxContext.fill();

		// Short central flash, brightest at the instant of collapse.
		var flashAlpha = Math.pow(1 - progress, 8);
		var flashRadius = effect.maxRadius * (0.07 + progress * 0.1);
		var flash = fxContext.createRadialGradient(
			effect.x, effect.y, 0,
			effect.x, effect.y, flashRadius
		);
		flash.addColorStop(0, 'rgba(255, 255, 255, ' + flashAlpha + ')');
		flash.addColorStop(0.18, 'rgba(220, 245, 255, ' + (flashAlpha * 0.92) + ')');
		flash.addColorStop(0.52, 'rgba(95, 190, 255, ' + (flashAlpha * 0.4) + ')');
		flash.addColorStop(1, 'rgba(70, 140, 255, 0)');
		fxContext.fillStyle = flash;
		fxContext.beginPath();
		fxContext.arc(effect.x, effect.y, flashRadius, 0, Math.PI * 2);
		fxContext.fill();
		fxContext.restore();

		// Fast luminous debris with short trails and natural drag.
		for (var j = 0; j < effect.particles.length; j++) {
			var particle = effect.particles[j];
			if (particle.age >= particle.life) continue;

			var previousX = particle.x;
			var previousY = particle.y;
			particle.x += particle.vx * dt;
			particle.y += particle.vy * dt;
			var drag = Math.exp(-1.7 * dt);
			particle.vx *= drag;
			particle.vy *= drag;
			particle.age += dt;

			var lifeProgress = particle.age / particle.life;
			var particleAlpha = Math.pow(1 - lifeProgress, 1.5);
			var blueTint = particle.tint > 0.22;

			fxContext.save();
			fxContext.globalCompositeOperation = 'lighter';
			fxContext.globalAlpha = particleAlpha;
			fxContext.lineCap = 'round';
			fxContext.lineWidth = particle.size * (0.7 + particleAlpha);
			fxContext.strokeStyle = blueTint ? 'rgba(125, 205, 255, 0.9)' : 'rgba(255, 245, 225, 0.95)';
			fxContext.shadowColor = blueTint ? '#68bfff' : '#fff0d2';
			fxContext.shadowBlur = 8 * particleAlpha;
			fxContext.beginPath();
			fxContext.moveTo(previousX, previousY);
			fxContext.lineTo(
				particle.x - particle.vx * particle.stretch,
				particle.y - particle.vy * particle.stretch
			);
			fxContext.stroke();
			fxContext.restore();
		}
	}
}

function explodeBlackHole(index, now) {
	var collapsed = blackholes[index];

	// The whole merged object vanishes. No replacement black holes are spawned.
	spawnExplosionEffect(
		collapsed.x,
		collapsed.y,
		collapsed.currentRadius,
		now,
		collapsed.bodyCount
	);
	blackholes.splice(index, 1);
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

	var areaA = a.radius * a.radius;
	var areaB = b.radius * b.radius;
	a.gravity += b.gravity;
	a.mass += b.mass;
	a.bodyCount += b.bodyCount;
	a.radius = Math.sqrt(areaA + areaB);
	a.currentRadius = Math.sqrt(areaA + areaB * 3);
	a.radiusEase = 0;
	blackholes.splice(indexB, 1);
}

function resolveMergers(now) {
	var changed = true;
	while (changed) {
		changed = false;
		mergeSearch:
		for (var i = 0; i < blackholes.length; i++) {
			var a = blackholes[i];
			for (var j = i + 1; j < blackholes.length; j++) {
				var b = blackholes[j];
				var dx = b.x - a.x, dy = b.y - a.y;
				var distance = Math.sqrt(dx * dx + dy * dy);
				var mergeReach = 0;
				if (a.currentRadius >= b.radius) mergeReach = Math.max(mergeReach, a.currentRadius + b.radius);
				if (b.currentRadius >= a.radius) mergeReach = Math.max(mergeReach, b.currentRadius + a.radius);
				var touching = mergeReach > 0 && distance < mergeReach * MERGE_FACTOR;
				if (touching) {
					mergeBlackHoles(i, j);
					changed = true;
					if (blackholes[i].bodyCount >= EXPLOSION_BODY_COUNT) explodeBlackHole(i, now);
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

function drawPass(sourceTexture, targetFramebuffer, hole, flipY) {
	gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
	gl.viewport(0, 0, canvas.width, canvas.height);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
	gl.uniform1i(locationOfImage, 0);
	gl.uniform1f(locationOfFlipY, flipY ? 1 : 0);
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
		drawPass(backgroundTexture, null, null, false);
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
		drawPass(sourceTexture, targetFramebuffer, blackholes[i], i > 0);
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
	locationOfFlipY = gl.getUniformLocation(program, 'u_flip_y');
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