var bgUrl = 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=1427&q=80';

var BASE_RADIUS = 10;
var BASE_GRAVITY = 0.05;
var LENS_MASS = 10;
var MERGE_FACTOR = 0.85;
var EXPLOSION_BODY_COUNT = 32;

var blackholes = [];
var explosions = [];
var particles = [];
var PARTICLE_COUNT = 2000;
var PARTICLE_RADIUS = 1;
var PARTICLE_SPEED_LIMIT = 12;
var canvas, gl, fxCanvas, fxContext, particleBufferCanvas, particleBufferContext, program, quadBuffer, backgroundTexture;
var particleScreenWidth = 0, particleScreenHeight = 0;
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
		isMergeGhost: false,
		mergeOwner: null,
		mergeTween: null,
		mergeMassTween: null,
		dragging: false,
		dragOffsetX: 0,
		dragOffsetY: 0,
		pointerId: null
	};
}

function getCanvasPoint(event) {
	var rect = canvas.getBoundingClientRect();
	if (!rect.width || !rect.height) return null;
	return {
		x: (event.clientX - rect.left) / rect.width * canvas.width,
		y: (event.clientY - rect.top) / rect.height * canvas.height
	};
}

function findBlackHoleAt(point) {
	for (var i = blackholes.length - 1; i >= 0; i--) {
		var hole = blackholes[i];
		if (hole.isMergeGhost || hole.mergeTween || hole.mergeMassTween) continue;
		var dx = point.x - hole.x;
		var dy = point.y - hole.y;
		var hitRadius = Math.max(hole.radius, hole.currentRadius);
		if (dx * dx + dy * dy <= hitRadius * hitRadius) return hole;
	}
	return null;
}

function handlePointerDown(event) {
	if (event.button !== undefined && event.button !== 0) return;
	var point = getCanvasPoint(event);
	if (!point) return;

	var hit = findBlackHoleAt(point);
	if (hit) {
		hit.dragging = true;
		hit.pointerId = event.pointerId;
		hit.dragOffsetX = point.x - hit.x;
		hit.dragOffsetY = point.y - hit.y;
		canvas.style.cursor = 'grabbing';
	} else {
		blackholes.push(makeBlackHole(point.x, point.y));
	}

	if (canvas.setPointerCapture && event.pointerId !== undefined) {
		try { canvas.setPointerCapture(event.pointerId); } catch (error) {}
	}
	if (event.cancelable) event.preventDefault();
}

function handlePointerMove(event) {
	var point = getCanvasPoint(event);
	if (!point) return;

	var draggingHole = null;
	for (var i = 0; i < blackholes.length; i++) {
		var hole = blackholes[i];
		if (hole.dragging && (hole.pointerId === null || hole.pointerId === event.pointerId)) {
			draggingHole = hole;
			break;
		}
	}

	if (draggingHole) {
		draggingHole.x = point.x - draggingHole.dragOffsetX;
		draggingHole.y = point.y - draggingHole.dragOffsetY;
		canvas.style.cursor = 'grabbing';
		if (event.cancelable) event.preventDefault();
		return;
	}

	canvas.style.cursor = findBlackHoleAt(point) ? 'grab' : 'crosshair';
}

function handlePointerUp(event) {
	for (var i = 0; i < blackholes.length; i++) {
		var hole = blackholes[i];
		if (hole.dragging && (hole.pointerId === null || hole.pointerId === event.pointerId)) {
			hole.dragging = false;
			hole.pointerId = null;
		}
	}
	canvas.style.cursor = 'crosshair';
}

function handlePointerCancel(event) {
	handlePointerUp(event);
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
	var oldScreenWidth = particleScreenWidth || window.innerWidth || 1;
	var oldScreenHeight = particleScreenHeight || window.innerHeight || 1;
	var side = Math.max(window.innerWidth, window.innerHeight);
	var scaleX = side / oldWidth;
	var scaleY = side / oldHeight;
	var screenScaleX = window.innerWidth / oldScreenWidth;
	var screenScaleY = window.innerHeight / oldScreenHeight;

	for (var i = 0; i < blackholes.length; i++) {
		blackholes[i].x *= scaleX;
		blackholes[i].y *= scaleY;
	}

	// Keep particle positions aligned with the visible screen after resizing.
	for (i = 0; i < particles.length; i++) {
		particles[i].x *= screenScaleX;
		particles[i].y *= screenScaleY;
		particles[i].latestX *= screenScaleX;
		particles[i].latestY *= screenScaleY;
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
	if (particleBufferCanvas) {
		particleBufferCanvas.width = window.innerWidth;
		particleBufferCanvas.height = window.innerHeight;
	}
	particleScreenWidth = window.innerWidth;
	particleScreenHeight = window.innerHeight;
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

function createParticle() {
	return {
		x: Math.random() * particleScreenWidth,
		y: Math.random() * particleScreenHeight,
		latestX: 0,
		latestY: 0,
		vx: Math.random() * 2 - 1,
		vy: Math.random() * 2 - 1,
		radius: PARTICLE_RADIUS
	};
}

function initializeParticles(count) {
	particles = [];
	for (var i = 0; i < count; i++) {
		var particle = createParticle();
		particle.latestX = particle.x;
		particle.latestY = particle.y;
		particles.push(particle);
	}
}

function updateAndDrawParticles() {
	if (!particleBufferContext || !fxContext) return;

	var rect = canvas.getBoundingClientRect();
	var gravitySources = [];

	// Convert WebGL canvas coordinates into visible screen coordinates once per frame.
	for (var i = 0; i < blackholes.length; i++) {
		var hole = blackholes[i];
		if (hole.isMergeGhost) continue;
		gravitySources.push({
			x: rect.left + (hole.x / canvas.width) * rect.width,
			y: rect.top + (hole.y / canvas.height) * rect.height,
			gravity: hole.gravity
		});
	}

	// Match the preview's persistent particle trails: erase 35% of the previous frame.
	particleBufferContext.save();
	particleBufferContext.globalCompositeOperation = 'destination-out';
	particleBufferContext.globalAlpha = 0.35;
	particleBufferContext.fillRect(0, 0, particleScreenWidth, particleScreenHeight);
	particleBufferContext.restore();

	particleBufferContext.save();
	particleBufferContext.fillStyle = particleBufferContext.strokeStyle = '#fff';
	particleBufferContext.lineCap = particleBufferContext.lineJoin = 'round';
	particleBufferContext.lineWidth = PARTICLE_RADIUS * 2;

	// Every live black hole attracts every particle using the preview's normalized
	// constant-force rule. The velocity cap is also kept from the source file.
	particleBufferContext.beginPath();
	for (i = 0; i < particles.length; i++) {
		var p = particles[i];

		for (var j = 0; j < gravitySources.length; j++) {
			var source = gravitySources[j];
			var dx = source.x - p.x;
			var dy = source.y - p.y;
			var distance = Math.sqrt(dx * dx + dy * dy);
			if (distance > 0.0001) {
				p.vx += (dx / distance) * source.gravity;
				p.vy += (dy / distance) * source.gravity;
			}
		}

		var speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
		if (speed > PARTICLE_SPEED_LIMIT) {
			var speedScale = PARTICLE_SPEED_LIMIT / speed;
			p.vx *= speedScale;
			p.vy *= speedScale;
		}

		p.latestX = p.x;
		p.latestY = p.y;
		p.x += p.vx;
		p.y += p.vy;

		particleBufferContext.moveTo(p.x, p.y);
		particleBufferContext.lineTo(p.latestX, p.latestY);
	}
	particleBufferContext.stroke();

	particleBufferContext.beginPath();
	for (i = 0; i < particles.length; i++) {
		p = particles[i];
		particleBufferContext.moveTo(p.x, p.y);
		particleBufferContext.arc(p.x, p.y, p.radius, 0, Math.PI * 2, false);
	}
	particleBufferContext.fill();
	particleBufferContext.restore();

	// The particle-trail buffer and the explosion overlay share the transparent
	// foreground canvas, but are rendered in separate passes.
	fxContext.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
	fxContext.drawImage(particleBufferCanvas, 0, 0);
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

	for (var i = blackholes.length - 1; i >= 0; i--) {
		if (blackholes[i] === collapsed || blackholes[i].mergeOwner === collapsed) {
			blackholes.splice(i, 1);
		}
	}
}

function mergeBlackHoles(indexA, indexB, now) {
	var a = blackholes[indexA], b = blackholes[indexB];

	// Keep the larger object as the visual survivor. Its centre never teleports.
	if (b.radius > a.radius) {
		var swap = a;
		a = b;
		b = swap;
		blackholes[indexA] = a;
		blackholes[indexB] = b;
	}

	var areaA = a.radius * a.radius;
	var areaB = b.radius * b.radius;

	// Physical values combine immediately, but the visible lens mass is tweened.
	a.gravity += b.gravity;
	a.bodyCount += b.bodyCount;

	// Target radius is the area-conserving radius. currentRadius stays where it is
	// and approaches this target through the existing spring easing in updatePhysics.
	a.radius = Math.sqrt(areaA + areaB);
	a.radiusEase = 0;

	a.mergeMassTween = {
		from: a.mass,
		to: LENS_MASS * a.bodyCount,
		start: now,
		duration: 620
	};

	// Keep the absorbed lens in the render list briefly. It glides into the
	// survivor and fades out, while the survivor smoothly gains its lens mass.
	b.isMergeGhost = true;
	b.mergeOwner = a;
	b.mergeTween = {
		fromX: b.x,
		fromY: b.y,
		start: now,
		duration: 620,
		startMass: b.mass
	};
}

function resolveMergers(now) {
	var changed = true;
	while (changed) {
		changed = false;
		mergeSearch:
		for (var i = 0; i < blackholes.length; i++) {
			var a = blackholes[i];
			if (a.isMergeGhost || a.mergeTween || a.mergeMassTween) continue;
			for (var j = i + 1; j < blackholes.length; j++) {
				var b = blackholes[j];
				if (b.isMergeGhost || b.mergeTween || b.mergeMassTween) continue;
				var dx = b.x - a.x, dy = b.y - a.y;
				var distance = Math.sqrt(dx * dx + dy * dy);
				var mergeReach = 0;
				if (a.currentRadius >= b.radius) mergeReach = Math.max(mergeReach, a.currentRadius + b.radius);
				if (b.currentRadius >= a.radius) mergeReach = Math.max(mergeReach, b.currentRadius + a.radius);
				var touching = mergeReach > 0 && distance < mergeReach * MERGE_FACTOR;
				if (touching) {
					mergeBlackHoles(i, j, now);
					changed = true;
					if (blackholes[i].bodyCount >= EXPLOSION_BODY_COUNT) explodeBlackHole(i, now);
					break mergeSearch;
				}
			}
		}
	}
}

function updatePhysics(now) {
	var i, j;

	// Smoothly animate absorbed lenses toward their survivor and fade their
	// distortion away. Remove the ghost only when its visual transition ends.
	for (i = blackholes.length - 1; i >= 0; i--) {
		var hole = blackholes[i];

		if (hole.isMergeGhost) {
			var mergeProgress = Math.min(1, Math.max(0,
				(now - hole.mergeTween.start) / hole.mergeTween.duration
			));
			var mergeEase = mergeProgress * mergeProgress * (3 - 2 * mergeProgress);
			hole.x = hole.mergeTween.fromX +
				(hole.mergeOwner.x - hole.mergeTween.fromX) * mergeEase;
			hole.y = hole.mergeTween.fromY +
				(hole.mergeOwner.y - hole.mergeTween.fromY) * mergeEase;
			hole.mass = hole.mergeTween.startMass * (1 - mergeEase);

			if (mergeProgress >= 1 || !hole.mergeOwner) {
				blackholes.splice(i, 1);
			}
			continue;
		}

		hole.radiusEase = (hole.radiusEase + (hole.radius - hole.currentRadius) * 0.07) * 0.95;
		hole.currentRadius += hole.radiusEase;
		if (hole.currentRadius < 0) hole.currentRadius = 0;

		if (hole.mergeMassTween) {
			var massProgress = Math.min(1, Math.max(0,
				(now - hole.mergeMassTween.start) / hole.mergeMassTween.duration
			));
			var massEase = massProgress * massProgress * (3 - 2 * massProgress);
			hole.mass = hole.mergeMassTween.from +
				(hole.mergeMassTween.to - hole.mergeMassTween.from) * massEase;

			if (massProgress >= 1) {
				hole.mass = hole.mergeMassTween.to;
				hole.mergeMassTween = null;
			}
		} else {
			var targetMass = LENS_MASS * hole.bodyCount;
			if (hole.mass < targetMass * 0.999) {
				hole.mass += (targetMass - hole.mass) * 0.03;
			}
		}
	}

	resolveMergers(now);

	// Match preview (5).html: each active body attracts every other active body
	// with its gravity value. Merge ghosts are render-only during their fade-out.
	var activeHoles = [];
	for (i = 0; i < blackholes.length; i++) {
		if (!blackholes[i].isMergeGhost) activeHoles.push(blackholes[i]);
	}

	var movementX = new Float64Array(activeHoles.length);
	var movementY = new Float64Array(activeHoles.length);

	for (i = 0; i < activeHoles.length; i++) {
		for (j = i + 1; j < activeHoles.length; j++) {
			var first = activeHoles[i], second = activeHoles[j];
			var dx = second.x - first.x;
			var dy = second.y - first.y;
			var distance = Math.sqrt(dx * dx + dy * dy);

			if (distance < 0.0001) continue;

			var nx = dx / distance;
			var ny = dy / distance;

			movementX[i] += nx * second.gravity;
			movementY[i] += ny * second.gravity;
			movementX[j] -= nx * first.gravity;
			movementY[j] -= ny * first.gravity;
		}
	}

	for (i = 0; i < activeHoles.length; i++) {
		if (!activeHoles[i].dragging) {
			activeHoles[i].x += movementX[i];
			activeHoles[i].y += movementY[i];
		}
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
	updateAndDrawParticles();
	drawExplosionEffects(now);
	window.requestAnimationFrame(render);
}

function init(image) {
	canvas = document.getElementById('glscreen');
	gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
	if (!gl) throw new Error('WebGL is not available in this browser.');

	fxCanvas = document.getElementById('fxscreen');
	fxContext = fxCanvas.getContext('2d');
	particleBufferCanvas = document.createElement('canvas');
	particleBufferContext = particleBufferCanvas.getContext('2d');
	resizeCanvas();
	initializeParticles(PARTICLE_COUNT);
	canvas.style.touchAction = 'none';
	canvas.style.cursor = 'crosshair';
	canvas.addEventListener('pointerdown', handlePointerDown);
	canvas.addEventListener('pointermove', handlePointerMove);
	canvas.addEventListener('pointerup', handlePointerUp);
	canvas.addEventListener('pointercancel', handlePointerCancel);
	canvas.addEventListener('lostpointercapture', handlePointerCancel);

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