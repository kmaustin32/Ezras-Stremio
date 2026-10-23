-- Manual encoded-black-bar detection. No startup or continuous autocropping.
-- Detection uses cropdetect metadata; the lasting crop is applied by the VO,
-- which supports hardware decoding and the existing ambient border blur.
local mp = require 'mp'
local label = 'stremio-fork-black-bars'
local timer, started, saved_hwdec, baseline_crop, locked_crop
local last_time, stable_since, previous, samples
local edge_candidate

local function status(state, message)
    mp.set_property_native('user-data/stremio-bar-detection', {
        state = state, crop = locked_crop or '', message = message or ''
    })
    if message then mp.osd_message(message, 3) end
end

local function stop_sampling()
    if timer then timer:kill(); timer = nil end
    for _, filter in ipairs(mp.get_property_native('vf', {})) do
        if filter.label == label then
            mp.commandv('no-osd', 'vf', 'remove', '@' .. label)
            break
        end
    end
    if saved_hwdec then
        -- Do not overwrite a hardware-decoding change made by the user.
        if mp.get_property('hwdec') == 'auto-copy' then
            mp.set_property('hwdec', saved_hwdec)
        end
        saved_hwdec = nil
    end
end

local function reset_crop()
    stop_sampling()
    if locked_crop and mp.get_property('video-crop') == locked_crop then
        mp.set_property('file-local-options/video-crop', baseline_crop or '')
    end
    locked_crop = nil
end

local function rectangle(meta)
    if not meta then return nil end
    local r = {}
    for _, key in ipairs({'w', 'h', 'x', 'y'}) do
        r[key] = tonumber(meta['lavfi.cropdetect.' .. key])
        if not r[key] or r[key] ~= math.floor(r[key]) then return nil end
    end
    return r
end

local function refined_axis(start, size, candidate_start, candidate_size, minimum)
    local before = candidate_start - start
    local after = start + size - candidate_start - candidate_size
    -- Remove only a measured near-black residue, never an unconditional inset.
    -- Larger disagreements could be actual dark picture content: keep the baseline.
    if before >= 0 and before <= 2 and after >= 0 and after <= 2 and candidate_size >= minimum then
        return candidate_start, candidate_size
    end
    return start, size
end

local function finish(r)
    local width = mp.get_property_number('width', 0)
    local height = mp.get_property_number('height', 0)
    stop_sampling()
    local decoded_w = mp.get_property_number('video-dec-params/w', width)
    local decoded_h = mp.get_property_number('video-dec-params/h', height)
    local output_w = mp.get_property_number('video-out-params/w', width)
    local output_h = mp.get_property_number('video-out-params/h', height)
    if decoded_w ~= output_w or decoded_h ~= output_h then
        status('uncertain', 'A video filter changes picture size: black-bar crop not applied.')
        return
    end
    if not r or width <= 0 or height <= 0 or r.x < 0 or r.y < 0 or
        r.w < width * 0.5 or r.h < height * 0.5 or
        r.x + r.w > width or r.y + r.h > height then
        status('uncertain', 'Black bars uncertain: picture unchanged. Try a brighter scene.')
        return
    end
    local right, bottom = width - r.x - r.w, height - r.y - r.h
    -- Ignore rounding-only differences, and reject unbalanced dark picture edges.
    local horizontal = r.x >= 4 and right >= 4 and math.abs(r.x - right) <= math.max(4, width * 0.02)
    local vertical = r.y >= 4 and bottom >= 4 and math.abs(r.y - bottom) <= math.max(4, height * 0.02)
    if not horizontal and not vertical then
        status('no-bars', 'No clear black bars: picture unchanged.')
        return
    end
    -- Crop only confidently detected axes. Preserve the other axis completely.
    if not horizontal then r.x = 0; r.w = width end
    if not vertical then r.y = 0; r.h = height end
    if r.refined then
        if horizontal then
            r.x, r.w = refined_axis(r.x, r.w, r.refined.x, r.refined.w, width * 0.5)
        end
        if vertical then
            r.y, r.h = refined_axis(r.y, r.h, r.refined.y, r.refined.h, height * 0.5)
        end
    end
    -- Shader upscalers run before the VO crop and can sample the encoded black
    -- pixels immediately outside it. Exclude one source pixel at confirmed bar
    -- boundaries, including when shaders are enabled later in the video. This
    -- keeps framing locked and retains unbarred axes completely intact.
    if horizontal and r.w - 2 >= width * 0.5 then r.x = r.x + 1; r.w = r.w - 2 end
    if vertical and r.h - 2 >= height * 0.5 then r.y = r.y + 1; r.h = r.h - 2 end
    local crop = string.format('%dx%d+%d+%d', r.w, r.h, r.x, r.y)
    local ok = mp.set_property('file-local-options/video-crop', crop)
    if not ok then
        status('error', 'Could not apply black-bar crop: picture unchanged.')
        return
    end
    locked_crop = crop
    status('locked', 'Black bars removed for this video. Ctrl+Shift+C restores the full frame.')
end

local function sample()
    local now = mp.get_time()
    local position = mp.get_property_number('time-pos')
    if mp.get_property_native('pause') or not position or
        (last_time and (position < last_time - 0.1 or position - last_time > 2)) then
        stop_sampling()
        status('cancelled', 'Black-bar detection cancelled: picture unchanged.')
        return
    end
    if not last_time or position > last_time + 0.01 then
        local r = rectangle(mp.get_property_native('vf-metadata/' .. label))
        local key = r and string.format('%d:%d:%d:%d', r.w, r.h, r.x, r.y)
        if key and key == previous then
            samples = samples + 1
        else
            previous = key
            stable_since = now
            samples = key and 1 or 0
        end
        last_time = position
        if samples >= 6 and now - stable_since >= 0.5 then
            if not edge_candidate then
                edge_candidate = r
                -- Measure the conservative baseline independently. Replacing our
                -- labelled filter retains unrelated filters and resets metadata.
                if not mp.commandv('no-osd', 'vf', 'add', '@' .. label .. ':cropdetect=limit=20/255:round=2:reset=0') then
                    stop_sampling()
                    status('error', 'Black-bar detection unavailable: picture unchanged.')
                    return
                end
                previous, samples, stable_since = nil, 0, now
            else
                r.refined = edge_candidate
                finish(r)
            end
            return
        end
    end
    if now - started >= 3 then
        stop_sampling()
        status('uncertain', 'Black bars uncertain: picture unchanged. Try a brighter scene.')
    end
end

local function detect()
    if timer then
        status('detecting', 'Detecting black bars...')
        return
    end
    if locked_crop then
        reset_crop()
        status('idle', 'Full frame restored. Ctrl+Shift+C detects black bars again.')
        return
    end
    if mp.get_property_native('current-tracks/video/image') ~= false or
        mp.get_property_number('width', 0) <= 0 then
        status('idle', 'Play a video before detecting black bars.')
        return
    end
    if mp.get_property_native('pause') then
        status('idle', 'Resume playback, then press Ctrl+Shift+C on a bright scene.')
        return
    end
    baseline_crop = mp.get_property('video-crop', '')
    local hardware = mp.get_property('hwdec-current', 'no')
    if hardware ~= 'no' and not hardware:find('%-copy$') then
        saved_hwdec = mp.get_property('hwdec', 'no')
        if not mp.set_property('hwdec', 'auto-copy') then
            saved_hwdec = nil
            status('error', 'Black-bar detection unavailable with this decoder.')
            return
        end
    end
    -- Accumulate the largest bright picture across frames, rather than crop to
    -- a single dark frame. Remove this labelled filter when sampling finishes.
    local ok = mp.commandv('no-osd', 'vf', 'pre', '@' .. label .. ':cropdetect=limit=32/255:round=2:reset=0')
    if not ok then
        stop_sampling()
        status('error', 'Black-bar detection unavailable: picture unchanged.')
        return
    end
    started = mp.get_time()
    last_time, previous, samples = nil, nil, 0
    edge_candidate = nil
    stable_since = started
    status('detecting', 'Detecting black bars...')
    timer = mp.add_periodic_timer(0.1, sample)
end

mp.register_script_message('detect', detect)
mp.add_key_binding('Ctrl+Shift+c', 'detect-black-bars', detect)
mp.register_event('start-file', function() reset_crop(); baseline_crop = nil; status('idle') end)
mp.register_event('end-file', function() reset_crop(); baseline_crop = nil; status('idle') end)
mp.register_event('shutdown', stop_sampling)
status('idle')
